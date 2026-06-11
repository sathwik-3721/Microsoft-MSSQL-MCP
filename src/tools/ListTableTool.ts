import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class ListTableTool implements Tool {
  [key: string]: any;
  name = "list_table";
  description = "Lists tables in an MSSQL Database, or list tables in specific schemas";
  inputSchema = {
    type: "object",
    properties: {
      parameters: { 
        type: "array", 
        description: "Schemas to filter by (optional)",
        items: {
          type: "string"
        },
        minItems: 0
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
        // Parameterize each schema name to prevent SQL injection
        const placeholders = (parameters as string[]).map((schema: string, i: number) => {
          request.input(`schema${i}`, sql.NVarChar, schema);
          return `@schema${i}`;
        });
        schemaFilter = `AND TABLE_SCHEMA IN (${placeholders.join(", ")})`;
      }
      query = `SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ${schemaFilter} ORDER BY TABLE_SCHEMA, TABLE_NAME`;
      const result = await request.query(query);
      return {
        success: true,
        message: `List tables executed successfully`,
        items: result.recordset,
        query,
      };
    } catch (error) {
      console.error("Error listing tables:", error);
      return {
        success: false,
        message: `Failed to list tables: ${error}`,
        query,
      };
    }
  }
}
