-- Migration: Unlimited Agent Hierarchy Level
-- Alter agent_hierarchies.level column from AgentHierarchyLevel enum to VARCHAR(50)
-- This allows storing LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, ... LEVEL_N without depth limits.

ALTER TABLE "agent_hierarchies" ALTER COLUMN "level" TYPE VARCHAR(50) USING "level"::text;
