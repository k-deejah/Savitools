import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateHorizonReplayHistory1798300000000 implements MigrationInterface {
  name = 'CreateHorizonReplayHistory1798300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'horizon_replay_history',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'userId',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'workspaceId',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'method',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'endpoint',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'params',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'network',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'statusCode',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'response',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'errorMessage',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'responseTime',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'transactionHash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'requestId',
            type: 'varchar',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'horizon_replay_history',
      new TableIndex({
        name: 'IDX_horizon_replay_userId',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createIndex(
      'horizon_replay_history',
      new TableIndex({
        name: 'IDX_horizon_replay_workspaceId',
        columnNames: ['workspaceId'],
      }),
    );

    await queryRunner.createIndex(
      'horizon_replay_history',
      new TableIndex({
        name: 'IDX_horizon_replay_network',
        columnNames: ['network'],
      }),
    );

    await queryRunner.createIndex(
      'horizon_replay_history',
      new TableIndex({
        name: 'IDX_horizon_replay_createdAt',
        columnNames: ['createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'horizon_replay_history',
      new TableIndex({
        name: 'IDX_horizon_replay_transactionHash',
        columnNames: ['transactionHash'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('horizon_replay_history', 'IDX_horizon_replay_transactionHash');
    await queryRunner.dropIndex('horizon_replay_history', 'IDX_horizon_replay_createdAt');
    await queryRunner.dropIndex('horizon_replay_history', 'IDX_horizon_replay_network');
    await queryRunner.dropIndex('horizon_replay_history', 'IDX_horizon_replay_workspaceId');
    await queryRunner.dropIndex('horizon_replay_history', 'IDX_horizon_replay_userId');
    await queryRunner.dropTable('horizon_replay_history');
  }
}
