/* Types for Whirl's tables, derived from its schema exactly as Convex's
   codegen would. Slates has no Convex deployment: ids are plain strings at
   runtime, and these types only keep the ported components honest. */
import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel } from "convex/server";
import type { GenericId } from "convex/values";

import type schema from "../schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | "_storage"> = GenericId<TableName>;
