import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
import { AuthGuard, CurrentUser, Roles, RolesGuard } from "./auth";
import { CONFIG, type Config } from "./config";
import { Database } from "./database";
import { ErrorDto, HealthDto, MachineDto, MachinesDto, MeDto } from "./dto";
import { REPOSITORY, type Repository, type Principal } from "./repository";
const codeSchema = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,31}$/, "Use a machine code such as WH-C.");
const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: codeSchema.optional(),
  })
  .strict();
@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}
  @Get("live")
  @ApiOkResponse({ type: HealthDto })
  live() {
    return { status: "ok" };
  }
  @Get("ready")
  @ApiOkResponse({ type: HealthDto })
  @ApiResponse({ status: 503, type: HealthDto })
  async ready() {
    let database = false;
    try {
      database = await this.db.ready();
    } catch {
      /* readiness reveals no connection details */
    }
    const auth = Boolean(
      this.config.SUPABASE_URL && this.config.SUPABASE_PUBLISHABLE_KEY,
    );
    const result = {
      status: database && auth ? "ready" : "not_ready",
      database: database ? "connected" : "unavailable",
      authentication: auth ? "configured" : "unconfigured",
    };
    if (!database || !auth) throw new ServiceUnavailableException(result);
    return result;
  }
}
@ApiTags("Identity")
@ApiBearerAuth()
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("me")
export class MeController {
  @Get()
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: Principal) {
    return { ...user, availableRoles: user.availableRoles ?? [user.role] };
  }
}
@ApiTags("Machines")
@ApiBearerAuth()
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...Object.values(Role))
@Controller("machines")
export class MachinesController {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}
  @Get()
  @ApiOkResponse({ type: MachinesDto })
  @ApiResponse({ status: 400, type: ErrorDto })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: "after",
    required: false,
    type: String,
    description: "Last machine code returned; scoped keyset pagination.",
  })
  async list(@CurrentUser() user: Principal, @Query() query: unknown) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const { limit, after } = parsed.data;
    const rows = await this.repo.machines(user, limit + 1, after);
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? items.at(-1)!.code : null,
    };
  }
  @Get(":code")
  @ApiOkResponse({ type: MachineDto })
  @ApiResponse({ status: 400, type: ErrorDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiParam({ name: "code", example: "WH-C" })
  async detail(@CurrentUser() user: Principal, @Param("code") code: string) {
    const parsed = codeSchema.safeParse(code);
    if (!parsed.success)
      throw new BadRequestException(
        "Invalid machine code. Use a code such as WH-C.",
      );
    const machine = await this.repo.machine(user, parsed.data);
    if (!machine)
      throw new NotFoundException(
        "Machine not found or unavailable to your account.",
      );
    return machine;
  }
}
