# Project task types

Each project starts with Task, Bug, Feature, and Knowledge Transfer (KT). Task is the initial default. Every existing work item is assigned its project's Task type during the migration.

Project admins and organization admins or owners can add and rename types, set the default, and remove unused types. The default must be changed before it can be removed. Active and archived tasks both count as usage. Changing the default applies to future work items. Renaming a type keeps existing assignments intact. Each type has a color from the status palette and an icon chosen from Clipboard, Bug, Sparkles, Book, Wrench, Flag, Star, and Lightning. The icon uses the selected color.

The create dialog offers the project's types and initially selects its default. Quick creation uses the default and opens task details, where members can change the type. Board, table, and assignment views show the type. Activity records capture the names at the time of a change.

The MCP project list exposes available types and the default. MCP clients can select a type by name on create or update and read it with task queries. Omission on update preserves the current type.

The rollout order is an additive D1 migration followed by both Workers. The migration also supports writes from older Worker versions during rollout. Verify migration and defaults, project isolation, permissions, type changes and history, and MCP round trips before release.
