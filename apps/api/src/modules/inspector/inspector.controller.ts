import { Body, Controller, Delete, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DecodeXdrDto } from './dto/decode-xdr.dto';
import { ReplayHorizonRequestDto, GetReplayHistoryDto } from './dto/replay-horizon-request.dto';
import { InspectorService } from './inspector.service';

@ApiTags('inspector')
@Controller('inspector')
export class InspectorController {
  constructor(private readonly inspectorService: InspectorService) {}

  @Get('tx/:hash')
  @ApiOperation({ summary: 'Fetch and decode a transaction by hash' })
  @ApiParam({ name: 'hash', description: 'Transaction hash (64 hex chars)' })
  @ApiQuery({ name: 'network', required: false, enum: ['testnet', 'mainnet'] })
  inspectTransaction(
    @Param('hash') hash: string,
    @Query('network') network?: 'testnet' | 'mainnet',
  ) {
    return this.inspectorService.inspectTransaction(hash, network ?? 'testnet');
  }

  @Get('tx/:hash/export')
  @ApiOperation({
    summary: 'Export a transaction breakdown as CSV (UTF-8 BOM for Excel)',
  })
  @ApiParam({ name: 'hash', description: 'Transaction hash (64 hex chars)' })
  @ApiQuery({ name: 'network', required: false, enum: ['testnet', 'mainnet'] })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportTransaction(
    @Param('hash') hash: string,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('network') network?: 'testnet' | 'mainnet',
  ) {
    const breakdown = await this.inspectorService.inspectTransaction(
      hash,
      network ?? 'testnet',
    );
    reply.header(
      'Content-Disposition',
      `attachment; filename="transaction-${hash.slice(0, 12)}.csv"`,
    );
    return this.inspectorService.exportTransactionCsv(breakdown);
  }

  @Get('tx/:hash/events')
  @ApiOperation({
    summary: 'Decode Soroban events for a transaction (typed args + topic filter)',
  })
  @ApiParam({ name: 'hash', description: 'Transaction hash (64 hex chars)' })
  @ApiQuery({ name: 'network', required: false, enum: ['testnet', 'mainnet'] })
  @ApiQuery({ name: 'contractId', required: false, description: 'Filter by contract ID (substring)' })
  @ApiQuery({ name: 'eventName', required: false, description: 'Filter by event name (substring)' })
  getTransactionEvents(
    @Param('hash') hash: string,
    @Query('network') network?: 'testnet' | 'mainnet',
    @Query('contractId') contractId?: string,
    @Query('eventName') eventName?: string,
  ) {
    return this.inspectorService.getTransactionEvents(hash, network ?? 'testnet', {
      contractId,
      eventName,
    });
  }

  /** Alias matching issue path shape: GET /api/v1/inspector/:txHash/events */
  @Get(':txHash/events')
  @ApiOperation({ summary: 'Alias for tx/:hash/events' })
  @ApiParam({ name: 'txHash', description: 'Transaction hash (64 hex chars)' })
  @ApiQuery({ name: 'network', required: false, enum: ['testnet', 'mainnet'] })
  @ApiQuery({ name: 'contractId', required: false })
  @ApiQuery({ name: 'eventName', required: false })
  getTransactionEventsAlias(
    @Param('txHash') txHash: string,
    @Query('network') network?: 'testnet' | 'mainnet',
    @Query('contractId') contractId?: string,
    @Query('eventName') eventName?: string,
  ) {
    return this.inspectorService.getTransactionEvents(txHash, network ?? 'testnet', {
      contractId,
      eventName,
    });
  }

  @Get('account/:publicKey/txs')
  @ApiOperation({ summary: 'Last 20 transactions for a Stellar account' })
  @ApiParam({ name: 'publicKey', description: 'Stellar public key (G…)' })
  @ApiQuery({ name: 'network', required: false, enum: ['testnet', 'mainnet'] })
  getAccountTransactions(
    @Param('publicKey') publicKey: string,
    @Query('network') network?: 'testnet' | 'mainnet',
  ) {
    return this.inspectorService.getAccountTransactions(publicKey, network ?? 'testnet');
  }

  @Post('decode-xdr')
  @ApiOperation({ summary: 'Decode raw XDR (offline, no Horizon call)' })
  decodeXdr(@Body() dto: DecodeXdrDto) {
    return this.inspectorService.decodeXdr(dto.xdr, dto.network ?? 'testnet');
  }

  @Post('replay')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Replay a Horizon API request and save to history' })
  async replayHorizonRequest(
    @CurrentUser() user: { id: string },
    @Body() dto: ReplayHorizonRequestDto,
  ) {
    // Use workspaceId from DTO or default to user ID for now
    const workspaceId = dto.workspaceId || user.id;
    const { replay, response } = await this.inspectorService.replayHorizonRequest(
      dto,
      user.id,
      workspaceId,
    );

    return {
      replay: {
        id: replay.id,
        method: replay.method,
        endpoint: replay.endpoint,
        network: replay.network,
        statusCode: replay.statusCode,
        responseTime: replay.responseTime,
        transactionHash: replay.transactionHash,
        requestId: replay.requestId,
        errorMessage: replay.errorMessage,
        createdAt: replay.createdAt,
      },
      response,
    };
  }

  @Get('replay/history')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Get replay history for the current user' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max 100 (default 50)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Offset for pagination (default 0)' })
  @ApiQuery({ name: 'network', required: false, enum: ['testnet', 'mainnet'] })
  @ApiQuery({ name: 'transactionHash', required: false, description: 'Filter by transaction hash' })
  @ApiQuery({ name: 'requestId', required: false, description: 'Filter by request ID' })
  @ApiQuery({ name: 'workspaceId', required: false, description: 'Filter by workspace ID' })
  async getReplayHistory(
    @CurrentUser() user: { id: string },
    @Query() query: GetReplayHistoryDto,
  ) {
    const workspaceId = query.workspaceId || user.id;
    const { replays, total } = await this.inspectorService.getReplayHistory(
      user.id,
      workspaceId,
      {
        limit: query.limit,
        offset: query.offset,
        network: query.network,
        transactionHash: query.transactionHash,
        requestId: query.requestId,
      },
    );

    return {
      replays: replays.map((r) => ({
        id: r.id,
        method: r.method,
        endpoint: r.endpoint,
        network: r.network,
        statusCode: r.statusCode,
        responseTime: r.responseTime,
        transactionHash: r.transactionHash,
        requestId: r.requestId,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
      })),
      total,
      limit: query.limit || 50,
      offset: query.offset || 0,
    };
  }

  @Delete('replay/:id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Delete a replay history record' })
  @ApiParam({ name: 'id', description: 'Replay record ID (UUID)' })
  async deleteReplayHistory(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const wsId = workspaceId || user.id;
    await this.inspectorService.deleteReplayHistory(id, user.id, wsId);
    return { success: true };
  }
}
