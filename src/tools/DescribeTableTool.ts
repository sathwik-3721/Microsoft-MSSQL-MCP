import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";


export class DescribeTableTool implements Tool {
  [key: string]: any;
  name = "get_table_schema";
  description = "Describes a specific table or view, returning columns, data types, business descriptions, physical foreign keys, and semantic join targets. Call this AFTER discovering tables to get deep-dive metadata for a specific entity.";
  inputSchema = {
    type: "object",
    properties: {
      tableName: { type: "string", description: "Name of the table to describe" },
    },
    required: ["tableName"],
  } as any;

  async run(params: { tableName: string }) {
    let query: string | undefined;
    try {
      const rawName = params?.tableName;
      if (!rawName || typeof rawName !== "string" || rawName.trim() === "") {
        return { success: false, message: "tableName is required" };
      }

      // Strip T-SQL bracket quoting e.g. [dbo].[agent_messages] → dbo.agent_messages
      const cleaned  = rawName.trim().replace(/\[([^\]]+)\]/g, "$1");
      const dotIndex = cleaned.indexOf(".");
      const schema   = dotIndex !== -1 ? cleaned.slice(0, dotIndex) : null;
      const table    = dotIndex !== -1 ? cleaned.slice(dotIndex + 1) : cleaned;

      const request = new sql.Request();
      request.input("tableName", sql.NVarChar, table);

      query = `
        SELECT
            c.name as name,
            ty.name as type,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable,
            CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END as has_default,
            ISNULL(CAST(ep.value AS NVARCHAR(MAX)), '') as description,
            ISNULL(fk.referenced_column, '') as foreign_key_target,
            ISNULL(CAST(ep_join.value AS NVARCHAR(MAX)), '') as semantic_join_target
        FROM sys.schemas s
        INNER JOIN sys.objects t ON s.schema_id = t.schema_id AND t.type IN ('U', 'V')
        INNER JOIN sys.columns c ON t.object_id = c.object_id
        INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
        LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id 
            AND ep.minor_id = c.column_id 
            AND ep.name = 'MS_Description'
        LEFT JOIN sys.extended_properties ep_join ON ep_join.major_id = t.object_id 
            AND ep_join.minor_id = c.column_id 
            AND ep_join.name = 'SemanticJoinTarget'
        OUTER APPLY (
            SELECT TOP 1
                OBJECT_SCHEMA_NAME(fk_cols.referenced_object_id) + '.' + OBJECT_NAME(fk_cols.referenced_object_id) + '.' + rc.name AS referenced_column
            FROM sys.foreign_key_columns fk_cols
            INNER JOIN sys.columns rc ON fk_cols.referenced_object_id = rc.object_id AND fk_cols.referenced_column_id = rc.column_id
            WHERE fk_cols.parent_object_id = c.object_id AND fk_cols.parent_column_id = c.column_id
        ) fk
        WHERE t.name = @tableName
      `;

      if (schema) {
        request.input("tableSchema", sql.NVarChar, schema);
        query += ` AND s.name = @tableSchema`;
      }

      query += ` ORDER BY c.column_id`;

      const result = await request.query(query);
      if (result.recordset.length === 0) {
        return {
          success: false,
          message: `Table '${rawName}' not found or has no columns. Use list_table or list_view to get exact table names.`,
          columns: [],
          query,
        };
      }
      return {
        success: true,
        columns: result.recordset,
        query,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to describe table: ${error}`,
        query,
      };
    }
  }
}
