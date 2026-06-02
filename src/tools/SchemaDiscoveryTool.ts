import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class SchemaDiscoveryTool implements Tool {
  [key: string]: any;
  name = "schema_discovery";
  description = "Discover schema information: tables, columns, types, nullability, defaults, and table-level descriptions.";
  inputSchema = {
    type: "object",
    properties: {
      schema: { 
        type: "string", 
        description: "Optional schema name to filter by (default: all schemas)" 
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

      query = `
        SELECT
            s.name as schema_name,
            t.name as table_name,
            c.name as column_name,
            ty.name as column_type,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable,
            CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END as has_default,
            ISNULL(CAST(ep.value AS NVARCHAR(MAX)), '') as table_description
        FROM sys.schemas s
        INNER JOIN sys.tables t ON s.schema_id = t.schema_id
        INNER JOIN sys.columns c ON t.object_id = c.object_id
        INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
        LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id 
            AND ep.minor_id = 0 
            AND ep.name = 'MS_Description'
        ${schemaFilter}
        ORDER BY schema_name, table_name, c.column_id
      `;

      const result = await request.query(query);
      return {
        success: true,
        columns: result.recordset,
        query,
      };
    } catch (error) {
      console.error("Error executing schema discovery:", error);
      return {
        success: false,
        message: `Failed to discover schema: ${error}`,
        query,
      };
    }
  }
}
