import { MigrationInterface } from 'typeorm';

import { User } from '../modules/auth/entities/user.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { ConnectedAccount } from '../modules/auth/entities/connected-account.entity';
import { PasskeyCredential } from '../modules/auth/entities/passkey.entity';
import { VaultKey } from '../modules/auth/entities/vault-key.entity';
import { Workspace } from '../modules/workspace/entities/workspace.entity';
import { ApiKey } from '../modules/playground/entities/api-key.entity';
import { PlaygroundHistory } from '../modules/playground/entities/playground-history.entity';
import { Watch } from '../modules/monitor/entities/watch.entity';
import { WatchEvent } from '../modules/monitor/entities/watch-event.entity';
import { AlertEvent } from '../modules/monitor/entities/alert-event.entity';
import { MonitorWebhook } from '../modules/monitor/entities/monitor-webhook.entity';
import { TransactionReplay } from '../modules/transaction/entities/transaction-replay.entity';
import { NetworkSample } from '../modules/network/entities/network-sample.entity';
import { NetworkProfile } from '../modules/network/entities/network-profile.entity';
import { HorizonReplay } from '../modules/inspector/entities/horizon-replay.entity';

import { CreateLedgerMonitor1752926400000 } from './migrations/1752926400000-create-ledger-monitor';
import { CreatePlaygroundHistory1784642239000 } from './migrations/1784642239000-create-playground-history';
import { AddMonitorStateAlerts1785312000000 } from './migrations/1785312000000-add-monitor-state-alerts';
import { AddAuthEnhancements1785398400000 } from './migrations/1785398400000-add-auth-enhancements';
import { AddRefreshTokenRotationTracking1785484800000 } from './migrations/1785484800000-add-refresh-token-rotation-tracking';
import { CreateGraphSnapshots1785600000000 } from './migrations/1785600000000-create-graph-snapshots';
import { CreateTransactionReplay1785700000000 } from './migrations/1785700000000-create-transaction-replay';
import { CreateNetworkSamples1785786400000 } from './migrations/1785786400000-create-network-samples';
import { CreateTransactionSequence1786000000000 } from './migrations/1786000000000-create-transaction-sequence';
import { AddPasswordReset1786100000000 } from './migrations/1786100000000-add-password-reset';
import { CreatePasskeys1786200000000 } from './migrations/1786200000000-create-passkeys';
import { AddSecretEncryptionVersioning1786300000000 } from './migrations/1786300000000-add-secret-encryption-versioning';
import { CreateNetworkProfiles1786400000000 } from './migrations/1786400000000-create-network-profiles';
import { WorkspaceDefaultUniqueIndex1786400000000 } from './migrations/1786400000000-workspace-default-unique-index';
import { DropGraphSnapshots1786500000000 } from './migrations/1786500000000-drop-graph-snapshots';
import { DropTransactionSequenceRun1790607330235 } from './migrations/1790607330235-drop-transaction-sequence-run';
import { CreateHorizonReplayHistory1798300000000 } from './migrations/1798300000000-create-horizon-replay-history';

/** A TypeORM migration constructor as passed to `DataSourceOptions.migrations`. */
export type MigrationClass = new () => MigrationInterface;

/** A TypeORM entity constructor as passed to `DataSourceOptions.entities`. */
export type EntityClass = new (...args: never[]) => object;

/**
 * Every entity TypeORM should know about, in one place.
 *
 * Runtime (`app.module.ts`) and the CLI (`data-source.ts`) both consume this
 * list, so the two can no longer drift apart. `database.registry.spec.ts`
 * fails when an entity file on disk is missing from this array.
 */
export const ALL_ENTITIES: EntityClass[] = [
  User,
  RefreshToken,
  ConnectedAccount,
  PasskeyCredential,
  VaultKey,
  Workspace,
  ApiKey,
  PlaygroundHistory,
  Watch,
  WatchEvent,
  AlertEvent,
  MonitorWebhook,
  TransactionReplay,
  NetworkSample,
  NetworkProfile,
  HorizonReplay,
];

/**
 * Every migration, in timestamp order, in one place.
 *
 * Runtime and the CLI both consume this list. `database.registry.spec.ts`
 * fails when a migration file on disk is missing from this array, and both
 * entry points are asserted to use this exact array.
 */
export const ALL_MIGRATIONS: MigrationClass[] = [
  CreateLedgerMonitor1752926400000,
  CreatePlaygroundHistory1784642239000,
  AddMonitorStateAlerts1785312000000,
  AddAuthEnhancements1785398400000,
  AddRefreshTokenRotationTracking1785484800000,
  CreateGraphSnapshots1785600000000,
  CreateTransactionReplay1785700000000,
  CreateNetworkSamples1785786400000,
  CreateTransactionSequence1786000000000,
  AddPasswordReset1786100000000,
  CreatePasskeys1786200000000,
  AddSecretEncryptionVersioning1786300000000,
  CreateNetworkProfiles1786400000000,
  // Same timestamp as CreateNetworkProfiles; ordered by file name, which is how
  // the migrations directory reads. It ran on the runtime path before this list
  // was the only source, so dropping it would leave the CLI behind the schema.
  WorkspaceDefaultUniqueIndex1786400000000,
  DropGraphSnapshots1786500000000,
  DropTransactionSequenceRun1790607330235,
  CreateHorizonReplayHistory1798300000000,
];
