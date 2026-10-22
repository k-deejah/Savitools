import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HorizonReplay } from './entities/horizon-replay.entity';
import { ReplayHorizonRequestDto } from './dto/replay-horizon-request.dto';

// Mock axios module BEFORE any imports that use it
jest.mock('axios', () => {
  const mockFn: any = jest.fn();
  mockFn.isAxiosError = jest.fn();
  return {
    __esModule: true,
    default: mockFn,
    isAxiosError: mockFn.isAxiosError,
  };
});

// Now we can import InspectorService which uses axios
import { InspectorService } from './inspector.service';
import axios from 'axios';

const mockAxios = axios as jest.MockedFunction<typeof axios>;

describe('InspectorService - Horizon Replay', () => {
  let service: InspectorService;
  let horizonReplayRepo: jest.Mocked<Repository<HorizonReplay>>;
  let configService: jest.Mocked<ConfigService>;

  const mockUserId = 'user-123';
  const mockWorkspaceId = 'workspace-456';

  beforeEach(async () => {
    const mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    horizonReplayRepo = {
      create: jest.fn((data) => data as HorizonReplay),
      save: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
    } as any;

    configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        if (key === 'STELLAR_HORIZON_MAINNET_URL') return 'https://horizon.stellar.org';
        return defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InspectorService,
        {
          provide: getRepositoryToken(HorizonReplay),
          useValue: horizonReplayRepo,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<InspectorService>(InspectorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('replayHorizonRequest', () => {
    it('should successfully replay a GET request and save history', async () => {
      const dto: ReplayHorizonRequestDto = {
        method: 'GET',
        endpoint: '/transactions/abc123',
        params: { limit: 10 },
        network: 'testnet',
        transactionHash: 'abc123',
        requestId: 'req-001',
      };

      const mockResponse = {
        data: { id: 'abc123', successful: true },
        status: 200,
      };

      mockAxios.mockResolvedValueOnce(mockResponse);

      const result = await service.replayHorizonRequest(dto, mockUserId, mockWorkspaceId);

      expect(mockAxios).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/transactions/abc123',
        params: { limit: 10 },
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      expect(horizonReplayRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          workspaceId: mockWorkspaceId,
          method: 'GET',
          endpoint: '/transactions/abc123',
          params: { limit: 10 },
          statusCode: 200,
          network: 'testnet',
          transactionHash: 'abc123',
          requestId: 'req-001',
          errorMessage: null,
        })
      );

      expect(horizonReplayRepo.save).toHaveBeenCalled();
      expect(result.response).toEqual(mockResponse.data);
    });

    it('should replay on mainnet when specified', async () => {
      const dto: ReplayHorizonRequestDto = {
        method: 'GET',
        endpoint: '/ledgers/12345',
        network: 'mainnet',
      };

      const mockResponse = {
        data: { sequence: 12345 },
        status: 200,
      };

      mockAxios.mockResolvedValueOnce(mockResponse);

      await service.replayHorizonRequest(dto, mockUserId, mockWorkspaceId);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://horizon.stellar.org/ledgers/12345',
        })
      );
    });

    it('should handle 404 errors and save error message', async () => {
      const dto: ReplayHorizonRequestDto = {
        method: 'GET',
        endpoint: '/transactions/notfound',
        network: 'testnet',
      };

      const mockError = {
        response: {
          status: 404,
          data: { type: 'not_found', title: 'Resource Missing' },
        },
        message: 'Request failed with status code 404',
        isAxiosError: true,
      };

      mockAxios.mockRejectedValueOnce(mockError);
      (mockAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      const result = await service.replayHorizonRequest(dto, mockUserId, mockWorkspaceId);

      expect(horizonReplayRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          errorMessage: 'Request failed with status code 404',
        })
      );

      expect(result.replay).toBeDefined();
      expect(result.response).toEqual(mockError.response.data);
    });

    it('should handle network errors', async () => {
      const dto: ReplayHorizonRequestDto = {
        method: 'GET',
        endpoint: '/transactions/timeout',
        network: 'testnet',
      };

      const mockError = new Error('Network timeout');
      (mockAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);

      mockAxios.mockRejectedValueOnce(mockError);

      const result = await service.replayHorizonRequest(dto, mockUserId, mockWorkspaceId);

      expect(horizonReplayRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          errorMessage: 'Network timeout',
          response: null,
        })
      );
    });

    it('should track response time', async () => {
      const dto: ReplayHorizonRequestDto = {
        method: 'GET',
        endpoint: '/accounts/GABC',
        network: 'testnet',
      };

      mockAxios.mockResolvedValueOnce({
        data: { id: 'GABC' },
        status: 200,
      });

      await service.replayHorizonRequest(dto, mockUserId, mockWorkspaceId);

      expect(horizonReplayRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          responseTime: expect.any(Number),
        })
      );

      const call = horizonReplayRepo.create.mock.calls[0][0] as any;
      expect(call.responseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getReplayHistory', () => {
    it('should retrieve replay history with default pagination', async () => {
      const mockReplays = [
        {
          id: 'replay-1',
          method: 'GET',
          endpoint: '/transactions/abc',
          network: 'testnet',
          statusCode: 200,
          createdAt: new Date(),
        },
      ] as HorizonReplay[];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockReplays, 1]),
      };

      horizonReplayRepo.createQueryBuilder = jest.fn(() => mockQueryBuilder as any);

      const result = await service.getReplayHistory(mockUserId, mockWorkspaceId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('replay.userId = :userId', { userId: mockUserId });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('replay.workspaceId = :workspaceId', {
        workspaceId: mockWorkspaceId,
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('replay.createdAt', 'DESC');
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);

      expect(result.replays).toEqual(mockReplays);
      expect(result.total).toBe(1);
    });

    it('should filter by network', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      horizonReplayRepo.createQueryBuilder = jest.fn(() => mockQueryBuilder as any);

      await service.getReplayHistory(mockUserId, mockWorkspaceId, {
        network: 'mainnet',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('replay.network = :network', {
        network: 'mainnet',
      });
    });

    it('should filter by transaction hash', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      horizonReplayRepo.createQueryBuilder = jest.fn(() => mockQueryBuilder as any);

      await service.getReplayHistory(mockUserId, mockWorkspaceId, {
        transactionHash: 'abc123',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('replay.transactionHash = :transactionHash', {
        transactionHash: 'abc123',
      });
    });

    it('should respect custom limit and offset', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      horizonReplayRepo.createQueryBuilder = jest.fn(() => mockQueryBuilder as any);

      await service.getReplayHistory(mockUserId, mockWorkspaceId, {
        limit: 20,
        offset: 40,
      });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(40);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
    });

    it('should cap limit at 100', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      horizonReplayRepo.createQueryBuilder = jest.fn(() => mockQueryBuilder as any);

      await service.getReplayHistory(mockUserId, mockWorkspaceId, {
        limit: 500,
      });

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(100);
    });
  });

  describe('deleteReplayHistory', () => {
    it('should delete a replay record', async () => {
      const replayId = 'replay-123';

      horizonReplayRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });

      await service.deleteReplayHistory(replayId, mockUserId, mockWorkspaceId);

      expect(horizonReplayRepo.delete).toHaveBeenCalledWith({
        id: replayId,
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
      });
    });

    it('should throw NotFoundException if record not found', async () => {
      const replayId = 'nonexistent';

      horizonReplayRepo.delete = jest.fn().mockResolvedValue({ affected: 0 });

      await expect(
        service.deleteReplayHistory(replayId, mockUserId, mockWorkspaceId)
      ).rejects.toThrow(NotFoundException);
    });
  });
});
