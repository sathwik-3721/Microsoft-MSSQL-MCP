import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class ListSemanticEntitiesTool implements Tool {
  [key: string]: any;
  name = "list_all_tables_and_views";
  description = "Returns a high-level list of all available tables and views along with their business descriptions. Call this FIRST to discover what data is available in the database.";
  inputSchema = {
    type: "object",
    properties: {
      schema: {
        type: "string",
        description: "Optional schema name to filter by (default: all schemas)",
      },
    },
    required: [],
  } as any;

  async run(params: { schema?: string }) {
    let query: string | undefined;
    try {
      const request = new sql.Request();
      let schemaFilter = "";

      if (params?.schema) {
        request.input("schema", sql.NVarChar, params.schema);
        schemaFilter = "WHERE s.name = @schema";
      }

      // Tier 1 Query: Fetches Tables (U) and Views (V) with their descriptions, excluding columns.
      query = `
        SELECT 
            s.name AS schema_name,
            o.name AS entity_name,
            o.type_desc AS entity_type,
            ISNULL(CAST(ep.value AS NVARCHAR(MAX)), '') AS entity_description
        FROM sys.objects o
        INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
        LEFT JOIN sys.extended_properties ep 
            ON ep.major_id = o.object_id 
            AND ep.minor_id = 0 
            AND ep.name = 'MS_Description'
        WHERE o.type IN ('U', 'V')
        ${schemaFilter ? "AND s.name = @schema" : ""}
        ORDER BY schema_name, entity_name;
      `;

      const result = await request.query(query);
      return {
        success: true,
        message: "Successfully retrieved the semantic map of tables and views.",
        items: result.recordset,
        query,
      };
    } catch (error) {
      console.error("Error executing list_semantic_entities:", error);
      return {
        success: false,
        message: `Failed to discover semantic entities: ${error}`,
        query,
      };
    }
  }
}
