import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject, IsIn, IsNumber, Min, Max } from 'class-validator';

export class ReplayHorizonRequestDto {
  @ApiProperty({
    description: 'HTTP method for the Horizon request',
    enum: ['GET', 'POST'],
    example: 'GET'
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['GET', 'POST'])
  method: 'GET' | 'POST';

  @ApiProperty({
    description: 'Horizon API endpoint path (without base URL)',
    example: '/transactions/abc123...'
  })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({
    description: 'Request parameters (query params or body)',
    required: false,
    example: { limit: 10, order: 'desc' }
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, any>;

  @ApiProperty({
    description: 'Network to replay the request on',
    enum: ['testnet', 'mainnet'],
    default: 'testnet'
  })
  @IsOptional()
  @IsEnum(['testnet', 'mainnet'])
  network: 'testnet' | 'mainnet' = 'testnet';

  @ApiProperty({
    description: 'Transaction hash for reference/grouping (optional)',
    required: false,
    example: 'abc123...'
  })
  @IsOptional()
  @IsString()
  transactionHash?: string;

  @ApiProperty({
    description: 'Request ID from network inspector for correlation (optional)',
    required: false,
    example: 'req_abc123'
  })
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiProperty({
    description: 'Workspace ID (defaults to user ID if not provided)',
    required: false,
    example: 'ws_123'
  })
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class GetReplayHistoryDto {
  @ApiProperty({
    description: 'Maximum number of results (1-100)',
    default: 50,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    description: 'Offset for pagination',
    default: 0,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number;

  @ApiProperty({
    description: 'Network to filter by',
    enum: ['testnet', 'mainnet'],
    required: false
  })
  @IsOptional()
  @IsEnum(['testnet', 'mainnet'])
  network?: 'testnet' | 'mainnet';

  @ApiProperty({
    description: 'Transaction hash to filter by',
    required: false
  })
  @IsOptional()
  @IsString()
  transactionHash?: string;

  @ApiProperty({
    description: 'Request ID to filter by',
    required: false
  })
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiProperty({
    description: 'Workspace ID to filter by',
    required: false
  })
  @IsOptional()
  @IsString()
  workspaceId?: string;
}
