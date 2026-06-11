import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class SchemaDiscoveryTool implements Tool {
  [key: string]: any;
  name = "schema_discovery";
  description =
    "Discover schema information: tables, columns, types, nullability, defaults, and table-level descriptions.";
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
    try {
      const request = new sql.Request();
      let schemaFilter = "";

      if (params?.schema) {
        request.input("schema", sql.NVarChar, params.schema);
        schemaFilter = "WHERE s.name = @schema";
      }

      // un comment this if you only need table descriptions without column details
      // const query = `
      //   SELECT
      //       s.name as schema_name,
      //       t.name as table_name,
      //       c.name as column_name,
      //       ty.name as column_type,
      //       c.max_length,
      //       c.precision,
      //       c.scale,
      //       c.is_nullable,
      //       CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END as has_default,
      //       ISNULL(CAST(ep.value AS NVARCHAR(MAX)), '') as table_description
      //   FROM sys.schemas s
      //   INNER JOIN sys.tables t ON s.schema_id = t.schema_id
      //   INNER JOIN sys.columns c ON t.object_id = c.object_id
      //   INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      //   LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id
      //       AND ep.minor_id = 0
      //       AND ep.name = 'MS_Description'
      //   ${schemaFilter}
      //   ORDER BY schema_name, table_name, c.column_id
      // `;

      // use this if you want to include column-level descriptions as well (note: this will be slower on large schemas due to the additional joins)
      const query = `
          SELECT
            s.name AS schema_name,
            t.name AS table_name,
            c.name AS column_name,
            ty.name AS column_type,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable,
            CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END AS has_default,
            ISNULL(CAST(ep_table.value AS NVARCHAR(MAX)), '') AS table_description,
            ISNULL(CAST(ep_col.value AS NVARCHAR(MAX)), '') AS column_description
          FROM sys.schemas s
          INNER JOIN sys.tables t ON s.schema_id = t.schema_id
          INNER JOIN sys.columns c ON t.object_id = c.object_id
          INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
          LEFT JOIN sys.extended_properties ep_table 
            ON ep_table.major_id = t.object_id 
            AND ep_table.minor_id = 0 
            AND ep_table.name = 'MS_Description'
          LEFT JOIN sys.extended_properties ep_col 
            ON ep_col.major_id = c.object_id 
            AND ep_col.minor_id = c.column_id 
            AND ep_col.class = 1
            AND ep_col.name = 'MS_Description'
          ${schemaFilter}
          ORDER BY schema_name, table_name, c.column_id`;

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error("Error executing schema discovery:", error);
      return {
        success: false,
        message: `Failed to discover schema: ${error}`,
      };
    }
  }
}
