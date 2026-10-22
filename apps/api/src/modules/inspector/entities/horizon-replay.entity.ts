import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('horizon_replay_history')
export class HorizonReplay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column()
  @Index()
  workspaceId: string;

  @Column()
  method: string;

  @Column()
  endpoint: string;

  @Column('jsonb', { nullable: true })
  params: Record<string, any> | null;

  @Column({ type: 'varchar', length: 20 })
  @Index()
  network: 'testnet' | 'mainnet';

  @Column()
  statusCode: number;

  @Column('jsonb', { nullable: true })
  response: Record<string, any> | null;

  @Column({ nullable: true })
  errorMessage: string | null;

  @Column()
  responseTime: number;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @Column({ nullable: true })
  @Index()
  transactionHash: string | null;

  @Column({ nullable: true })
  requestId: string | null;
}
