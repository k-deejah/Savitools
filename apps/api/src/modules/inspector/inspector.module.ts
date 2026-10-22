import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InspectorController } from './inspector.controller';
import { InspectorService } from './inspector.service';
import { HorizonReplay } from './entities/horizon-replay.entity';

@Module({
  imports: [TypeOrmModule.forFeature([HorizonReplay])],
  controllers: [InspectorController],
  providers: [InspectorService],
  exports: [InspectorService],
})
export class InspectorModule {}
