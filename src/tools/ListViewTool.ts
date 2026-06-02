import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class ListViewTool implements Tool {
  [key: string]: any;
  name = "list_view";
  description = "Lists all views in the database, optionally filtered by schema. Use this to discover available views before querying them with read_data or describe_table.";
  inputSchema = {
    type: "object",
    properties: {
      parameters: {
        type: "array",
        description: "Schemas to filter by (optional), e.g. [\"dbo\"]",
        items: { type: "string" },
        minItems: 0,
      },
    },
    required: [],
  } as any;

  async run(params: any) {
    let query: string | undefined;
    try {
      const { parameters } = params;
      const request = new sql.Request();
      let schemaFilter = "";
      if (parameters && parameters.length > 0) {
        const placeholders = (parameters as string[]).map((schema: string, i: number) => {
          request.input(`schema${i}`, sql.NVarChar, schema);
          return `@schema${i}`;
        });
        schemaFilter = `AND v.TABLE_SCHEMA IN (${placeholders.join(", ")})`;
      }
      // INFORMATION_SCHEMA.VIEWS gives view name + definition
      // TABLE_TYPE = 'VIEW' in INFORMATION_SCHEMA.TABLES also works but lacks definition
      query = `
        SELECT
          v.TABLE_SCHEMA + '.' + v.TABLE_NAME AS view_name,
          v.VIEW_DEFINITION
        FROM INFORMATION_SCHEMA.VIEWS v
        WHERE 1=1 ${schemaFilter}
        ORDER BY v.TABLE_SCHEMA, v.TABLE_NAME
      `;
      const result = await request.query(query);
      return {
        success: true,
        message: `List views executed successfully`,
        items: result.recordset,
        query,
      };
    } catch (error) {
      console.error("Error listing views:", error);
      return {
        success: false,
        message: `Failed to list views: ${error}`,
        query,
      };
    }
  }
}
