import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class SchemaDiscoveryTool implements Tool {
  [key: string]: any;
  name = "schema_discovery";
  description =
    "Discover schema information: tables, views, columns, types, nullability, defaults, table/view descriptions, and relationships (Foreign Keys & Semantic Joins).";
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
      request.input("schema", sql.NVarChar, params?.schema || null);

      const query = `
        -- Query 1: Columns and Tables/Views Metadata
        SELECT
          s.name AS schema_name,
          t.name AS table_name,
          CASE WHEN t.type_desc = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS object_type,
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
        INNER JOIN sys.objects t ON s.schema_id = t.schema_id AND t.type IN ('U', 'V')
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
        WHERE (@schema IS NULL OR s.name = @schema)
        ORDER BY schema_name, table_name, c.column_id;

        -- Query 2: Relationships (Foreign Keys & Semantic Joins)
        SELECT 
          fk.name AS constraint_name,
          ps.name AS from_schema,
          pt.name AS from_table,
          pc.name AS from_column,
          rs.name AS to_schema,
          rt.name AS to_table,
          rc.name AS to_column,
          'FOREIGN_KEY' AS relationship_type
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables pt ON fkc.parent_object_id = pt.object_id
        INNER JOIN sys.schemas ps ON pt.schema_id = ps.schema_id
        INNER JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
        INNER JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
        INNER JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
        INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
        WHERE (@schema IS NULL OR ps.name = @schema OR rs.name = @schema)

        UNION ALL

        SELECT
          'SEMANTIC_JOIN' AS constraint_name,
          s.name AS from_schema,
          t.name AS from_table,
          c.name AS from_column,
          ISNULL(PARSENAME(CAST(ep.value AS NVARCHAR(MAX)), 3), s.name) AS to_schema,
          PARSENAME(CAST(ep.value AS NVARCHAR(MAX)), 2) AS to_table,
          PARSENAME(CAST(ep.value AS NVARCHAR(MAX)), 1) AS to_column,
          'SEMANTIC_JOIN' AS relationship_type
        FROM sys.extended_properties ep
        INNER JOIN sys.objects t ON ep.major_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        INNER JOIN sys.columns c ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
        WHERE ep.name = 'SemanticJoinTarget'
          AND (@schema IS NULL OR s.name = @schema OR ISNULL(PARSENAME(CAST(ep.value AS NVARCHAR(MAX)), 3), s.name) = @schema);
      `;

      const result = await request.query(query);
      const recordsets = result.recordsets as any[];
      return {
        success: true,
        columns: recordsets[0] || [],
        relationships: recordsets[1] || [],
      };
    } catch (error) {
      console.error("Error executing schema discovery:", error);
      return {
        success: false,
        message: `Failed to discover schema: ${error}`,
      };
    }
  }
}
