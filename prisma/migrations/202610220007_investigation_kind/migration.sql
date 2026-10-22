-- Enum values must commit before later migrations may reference them.
ALTER TYPE maintenance."WorkOrderKind" ADD VALUE IF NOT EXISTS 'INVESTIGATION';
