import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Between, LessThan } from "typeorm";
import type { Repository } from "typeorm";
import { NetworkProfile } from "./entities/network-profile.entity";
import { NetworkSample } from "./entities/network-sample.entity";
import { NetworkService } from "./network.service";
import { assertSafeDestination } from "../../common/ssrf-guard";

jest.mock("../../common/ssrf-guard", () => ({
  assertSafeDestination: jest.fn().mockResolvedValue(undefined),
}));

describe("NetworkService", () => {
  let service: NetworkService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
  };
  let networkProfileRepository: {
    findOne: jest.Mock;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    repository = {
      create: jest.fn((sample) => sample),
      save: jest.fn(async (sample) => sample),
      find: jest.fn(),
      delete: jest.fn(),
    };
    networkProfileRepository = {
      findOne: jest.fn(),
    };

    service = new NetworkService(
      {
        get: jest.fn((key: string, fallback?: string) => fallback),
      } as unknown as ConfigService,
      repository as unknown as Repository<NetworkSample>,
      networkProfileRepository as unknown as Repository<NetworkProfile>,
    );
  });

  afterEach(() => {
    const pollInterval = (service as unknown as { pollInterval?: NodeJS.Timeout }).pollInterval;
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });

  describe("pollAndStore", () => {
    it("stores a successful sample for each network", async () => {
      jest
        .spyOn(service, "fetchCurrentStatus")
        .mockImplementation(async (network) => ({
          timestamp: Date.now(),
          network: typeof network === "string" ? network : network.name,
          passphrase: "passphrase",
          ledger: {
            sequence: 1,
            closeTime: new Date().toISOString(),
            secondsSinceClose: 1,
            avgCloseTime: 5,
          },
          fees: {
            baseFee: { min: 100, mode: 100, max: 100 },
            percentiles: { p10: 100, p50: 100, p90: 100, p99: 100 },
          },
          latency: 25,
        }));

      await service.pollAndStore();

      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ network: "mainnet", ok: true, error: null }),
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ network: "testnet", ok: true, error: null }),
      );
    });

    it("stores a failed sample without blocking the other network", async () => {
      jest
        .spyOn(service, "fetchCurrentStatus")
        .mockImplementation(async (network) => {
          if (typeof network === "string" && network === "mainnet") {
            throw new Error("mainnet down");
          }
          return {
            timestamp: Date.now(),
            network: typeof network === "string" ? network : network.name,
            passphrase: "passphrase",
            ledger: {
              sequence: 1,
              closeTime: new Date().toISOString(),
              secondsSinceClose: 1,
              avgCloseTime: 5,
            },
            fees: {
              baseFee: { min: 100, mode: 100, max: 100 },
              percentiles: { p10: 100, p50: 100, p90: 100, p99: 100 },
            },
            latency: 25,
          };
        });

      await service.pollAndStore();

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          network: "mainnet",
          ok: false,
          error: "mainnet down",
        }),
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ network: "testnet", ok: true }),
      );
    });

    it("does not queue overlapping sampler runs", async () => {
      (service as unknown as { pollInProgress: boolean }).pollInProgress = true;

      await service.pollAndStore();

      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe("getHistory", () => {
    it("returns 1-minute buckets with uptime and latency summary", async () => {
      const samples: Partial<NetworkSample>[] = [
        sample("testnet", "2026-08-31T10:00:10.000Z", true, 100),
        sample("testnet", "2026-08-31T10:00:40.000Z", true, 200),
        sample("testnet", "2026-08-31T10:01:05.000Z", false, null),
        sample("testnet", "2026-08-31T10:02:05.000Z", true, 300),
      ];
      repository.find.mockResolvedValue(samples);

      const result = await service.getHistory(
        "testnet",
        "2026-08-31T10:00:00.000Z",
        "2026-08-31T10:03:00.000Z",
      );

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          network: "testnet",
          sampledAt: Between(
            new Date("2026-08-31T10:00:00.000Z"),
            new Date("2026-08-31T10:03:00.000Z"),
          ),
        },
        order: { sampledAt: "ASC" },
        take: 20_001,
      });
      expect(result.samples).toEqual([
        expect.objectContaining({
          sampledAt: "2026-08-31T10:00:00.000Z",
          ok: true,
          latencyMs: 150,
          sampleCount: 2,
          errorCount: 0,
        }),
        expect.objectContaining({
          sampledAt: "2026-08-31T10:01:00.000Z",
          ok: false,
          latencyMs: null,
          sampleCount: 1,
          errorCount: 1,
        }),
        expect.objectContaining({
          sampledAt: "2026-08-31T10:02:00.000Z",
          ok: true,
          latencyMs: 300,
          sampleCount: 1,
          errorCount: 0,
        }),
      ]);
      expect(result.summary).toEqual({
        uptimePercent: 66.67,
        p50LatencyMs: 150,
        p95LatencyMs: 300,
        outageCount: 1,
        sampleCount: 4,
      });
    });

    it("caches identical ranges without sharing mutable response objects", async () => {
      repository.find.mockResolvedValue([
        sample("mainnet", "2026-08-31T10:00:10.000Z", true, 100),
      ]);
      const args = [
        "mainnet" as const,
        "2026-08-31T10:00:00.000Z",
        "2026-08-31T10:01:00.000Z",
      ] as const;

      const first = await service.getHistory(...args);
      first.samples[0].ok = false;
      const second = await service.getHistory(...args);

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(second.samples[0].ok).toBe(true);
    });

    it("caches repeated requests that use the default rolling range", async () => {
      repository.find.mockResolvedValue([]);

      const first = await service.getHistory("mainnet");
      const second = await service.getHistory("mainnet");

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(second.from).toBe(first.from);
      expect(second.to).toBe(first.to);
    });

    it("rejects ranges whose raw sample count exceeds the aggregation limit", async () => {
      repository.find.mockResolvedValue(
        Array.from({ length: 20_001 }, () =>
          sample("mainnet", "2026-08-31T10:00:10.000Z", true, 100),
        ),
      );

      await expect(
        service.getHistory(
          "mainnet",
          "2026-08-31T10:00:00.000Z",
          "2026-08-31T10:01:00.000Z",
        ),
      ).rejects.toThrow(/more than 20000 samples/);
    });

    it("validates malformed and inverted date ranges", async () => {
      await expect(
        service.getHistory("mainnet", "not-a-date", undefined),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.getHistory(
          "mainnet",
          "2026-08-31T10:05:00.000Z",
          "2026-08-31T10:00:00.000Z",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("verifyNetworkPassphrase", () => {
    it("returns match true when passphrases match", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ network_passphrase: "Public Global Stellar Network ; September 2015" })),
      );

      const result = await service.verifyNetworkPassphrase(
        "https://horizon.stellar.org",
        "Public Global Stellar Network ; September 2015",
      );
      expect(result).toEqual({
        match: true,
        actualPassphrase: "Public Global Stellar Network ; September 2015",
      });
    });

    it("returns match false when passphrases mismatch", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ network_passphrase: "Test SDF Network ; September 2015" })),
      );

      const result = await service.verifyNetworkPassphrase(
        "https://horizon.stellar.org",
        "Public Global Stellar Network ; September 2015",
      );
      expect(result).toEqual({
        match: false,
        actualPassphrase: "Test SDF Network ; September 2015",
      });
    });
  });

  describe("replayHorizonRequest", () => {
    it("replays an allowlisted built-in GET and returns its response metadata", async () => {
      const fetchMock = jest
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ records: [] })));

      await expect(
        service.replayHorizonRequest("user-1", {
          kind: "ledgers",
          network: "mainnet",
          limit: 5,
        }),
      ).resolves.toMatchObject({
        path: "/ledgers?order=desc&limit=5",
        status: 200,
        body: { records: [] },
      });

      const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
      expect(requestUrl.toString()).toBe(
        "https://horizon.stellar.org/ledgers?order=desc&limit=5",
      );
      expect(requestOptions).toEqual(
        expect.objectContaining({ method: "GET", redirect: "manual" }),
      );
      expect(assertSafeDestination).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/ledgers" }),
        ["https://horizon.stellar.org"],
      );
    });

    it("rejects invalid resource identifiers and oversized results", async () => {
      const fetchMock = jest.spyOn(global, "fetch");

      await expect(
        service.replayHorizonRequest("user-1", {
          kind: "account",
          network: "testnet",
          accountId: "not-an-account",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(
        new Response("{}", {
          headers: { "content-length": "1000001" },
        }),
      );
      await expect(
        service.replayHorizonRequest("user-1", {
          kind: "fee_stats",
          network: "testnet",
        }),
      ).rejects.toThrow(/1 MB replay limit/);
    });

    it("uses only network profiles owned by the caller", async () => {
      networkProfileRepository.findOne.mockResolvedValue(null);

      await expect(
        service.replayHorizonRequest("user-1", {
          kind: "fee_stats",
          profileId: "another-users-profile",
        }),
      ).rejects.toThrow("Network profile not found");
      expect(networkProfileRepository.findOne).toHaveBeenCalledWith({
        where: { id: "another-users-profile", ownerId: "user-1" },
      });
    });

    it("returns a gateway error when Horizon cannot be reached", async () => {
      jest.spyOn(global, "fetch").mockRejectedValueOnce(new Error("connection failed"));

      await expect(
        service.replayHorizonRequest("user-1", {
          kind: "fee_stats",
          network: "mainnet",
        }),
      ).rejects.toThrow("Horizon request failed or timed out");
    });
  });

  describe("pruneRetention", () => {
    it("deletes samples older than 90 days", async () => {
      await service.pruneRetention(new Date("2026-08-31T12:00:00.000Z"));

      expect(repository.delete).toHaveBeenCalledWith({
        sampledAt: LessThan(new Date("2026-06-02T12:00:00.000Z")),
      });
    });
  });
});

function sample(
  network: "mainnet" | "testnet",
  sampledAt: string,
  ok: boolean,
  latencyMs: number | null,
): Partial<NetworkSample> {
  return {
    network,
    sampledAt: new Date(sampledAt),
    ok,
    latencyMs,
    horizonBaseUrl:
      network === "mainnet"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org",
    error: ok ? null : "timeout",
  };
}
