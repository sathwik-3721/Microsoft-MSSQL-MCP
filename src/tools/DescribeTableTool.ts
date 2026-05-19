import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";


export class DescribeTableTool implements Tool {
  [key: string]: any;
  name = "describe_table";
  description = "Describes the schema (columns and types) of a specified MSSQL Database table.";
  inputSchema = {
    type: "object",
    properties: {
      tableName: { type: "string", description: "Name of the table to describe" },
    },
    required: ["tableName"],
  } as any;

  async run(params: { tableName: string }) {
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

      let query = `SELECT COLUMN_NAME as name, DATA_TYPE as type
                   FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_NAME = @tableName`;

      if (schema) {
        request.input("tableSchema", sql.NVarChar, schema);
        query += ` AND TABLE_SCHEMA = @tableSchema`;
      }

      query += ` ORDER BY ORDINAL_POSITION`;

      const result = await request.query(query);
      if (result.recordset.length === 0) {
        return {
          success: false,
          message: `Table '${rawName}' not found or has no columns. Use list_table or list_view to get exact table names.`,
          columns: [],
        };
      }
      return {
        success: true,
        columns: result.recordset,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to describe table: ${error}`,
      };
    }
  }
}
