import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { parseTableName, quotedTable } from "./tableUtils.js";

export class CreateIndexTool implements Tool {
  [key: string]: any;
  name = "create_index";
  description = "Creates an index on a specified column or columns in an MSSQL Database table";
  inputSchema = {
    type: "object",
    properties: {
      schemaName: { type: "string", description: "Name of the schema containing the table" },
      tableName: { type: "string", description: "Name of the table to create index on" },
      indexName: { type: "string", description: "Name for the new index" },
      columns: { 
        type: "array", 
        items: { type: "string" },
        description: "Array of column names to include in the index" 
      },
      isUnique: { 
        type: "boolean", 
        description: "Whether the index should enforce uniqueness (default: false)",
        default: false
      },
      isClustered: { 
        type: "boolean", 
        description: "Whether the index should be clustered (default: false)",
        default: false
      },
    },
    required: ["tableName", "indexName", "columns"],
  } as any;

  async run(params: any) {
    let query: string | undefined;
    try {
      const { schemaName, tableName, indexName, columns, isUnique = false, isClustered = false } = params;

      // Build a reliable quoted table reference.
      // schemaName may be passed separately OR embedded in tableName (e.g. "dbo.orders").
      const ref = parseTableName(tableName);
      if (schemaName && !ref.schema) ref.schema = schemaName;
      const tableRef = quotedTable(ref);

      let indexType = isClustered ? "CLUSTERED" : "NONCLUSTERED";
      if (isUnique) indexType = `UNIQUE ${indexType}`;

      const columnNames = (columns as string[]).map((c) => `[${c}]`).join(", ");
      const request = new sql.Request();
      query = `CREATE ${indexType} INDEX [${indexName}] ON ${tableRef} (${columnNames})`;
      await request.query(query);
      
      return {
        success: true,
        message: `Index [${indexName}] created successfully on table [${ref.schema ?? "dbo"}.${ref.table}]`,
        details: {
          schemaName: ref.schema ?? "dbo",
          tableName: ref.table,
          indexName,
          columnNames,
          isUnique,
          isClustered
        },
        query,
      };
    } catch (error) {
      console.error("Error creating index:", error);
      return {
        success: false,
        message: `Failed to create index: ${error}`,
        query,
      };
    }
  }
}