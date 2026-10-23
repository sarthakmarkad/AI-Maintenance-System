import { ApiProperty } from "@nestjs/swagger";
export class ReportCountsDto {
  @ApiProperty() open!: number;
  @ApiProperty() closed!: number;
  @ApiProperty() skipped!: number;
}
export class ReportRowDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) orderId!: string | null;
  @ApiProperty({ type: [String] }) cells!: string[];
}
export class ReportPreviewDto {
  @ApiProperty() report!: string;
  @ApiProperty() title!: string;
  @ApiProperty() organization!: string;
  @ApiProperty() machineCode!: string;
  @ApiProperty() machineName!: string;
  @ApiProperty() generatedAt!: string;
  @ApiProperty() requestedBy!: string;
  @ApiProperty() requestedRole!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() basis!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: String, nullable: true }) kind!: string | null;
  @ApiProperty() total!: number;
  @ApiProperty({ type: ReportCountsDto }) counts!: ReportCountsDto;
  @ApiProperty({ type: String, nullable: true }) warning!: string | null;
  @ApiProperty({ type: [String] }) notes!: string[];
  @ApiProperty({ type: [String] }) columns!: string[];
  @ApiProperty({ type: [ReportRowDto] }) rows!: ReportRowDto[];
  @ApiProperty() fingerprint!: string;
  @ApiProperty() previewLimit!: number;
}
