// hyper-db C# (Mono v2) client runtime.
//
// PRD risk rule: Mono v2 is beta — this client stays isolated, can be disabled
// with `setr hyperdb_cs_enabled 0`, and every C# consumer module MUST keep a
// Lua/TS fallback path.
//
// Async model: Mono v2 Coroutine<T> only — Task is forbidden on the FiveM
// main thread. Boundary payload: (queryId|table, descriptor?, flat args).

using System;
using System.Collections.Generic;
using System.Text;
using CitizenFX.Core;
using CitizenFX.Server;

namespace HyperDb.Runtime
{
    /// <summary>Boundary error rehydrated as a typed exception.</summary>
    public sealed class HyperDbException : Exception
    {
        public string Code { get; }

        public HyperDbException(string code, string message) : base(message)
        {
            Code = code;
        }
    }

    /// <summary>Generated column descriptor; produces chain filter segments.</summary>
    public sealed class Column
    {
        public string Name { get; }

        public Column(string name) { Name = name; }

        public ColumnFilter Eq(object value) => new ColumnFilter(Name, "eq", value);
        public ColumnFilter Ne(object value) => new ColumnFilter(Name, "ne", value);
        public ColumnFilter Gt(object value) => new ColumnFilter(Name, "gt", value);
        public ColumnFilter Gte(object value) => new ColumnFilter(Name, "gte", value);
        public ColumnFilter Lt(object value) => new ColumnFilter(Name, "lt", value);
        public ColumnFilter Lte(object value) => new ColumnFilter(Name, "lte", value);
        public ColumnFilter Like(string pattern) => new ColumnFilter(Name, "like", pattern);
    }

    public sealed class ColumnFilter
    {
        public string Column { get; }
        public string Op { get; }
        public object Value { get; }

        public ColumnFilter(string column, string op, object value)
        {
            Column = column;
            Op = op;
            Value = value;
        }
    }

    /// <summary>
    /// Generated method chain (no LINQ expression trees — predictable and
    /// fast). Assembles the flat chain descriptor understood by the core
    /// resource: w:&lt;col&gt;:&lt;op&gt;;o:&lt;col&gt;:&lt;dir&gt;;l;of
    /// </summary>
    public sealed class QueryChain<TRow> where TRow : new()
    {
        private readonly string _table;
        private readonly StringBuilder _descriptor = new StringBuilder();
        private readonly List<object> _args = new List<object>();

        public QueryChain(string table) { _table = table; }

        private void Append(string segment)
        {
            if (_descriptor.Length > 0) _descriptor.Append(';');
            _descriptor.Append(segment);
        }

        public QueryChain<TRow> Where(ColumnFilter filter)
        {
            Append($"w:{filter.Column}:{filter.Op}");
            _args.Add(filter.Value);
            return this;
        }

        public QueryChain<TRow> OrderBy(Column column)
        {
            Append($"o:{column.Name}:asc");
            return this;
        }

        public QueryChain<TRow> OrderByDesc(Column column)
        {
            Append($"o:{column.Name}:desc");
            return this;
        }

        public QueryChain<TRow> Limit(int n)
        {
            Append("l");
            _args.Add(n);
            return this;
        }

        public QueryChain<TRow> Offset(int n)
        {
            Append("of");
            _args.Add(n);
            return this;
        }

        public Coroutine<List<TRow>> Execute()
            => Db.ExecuteChain<TRow>(_table, _descriptor.ToString(), _args.ToArray());
    }

    /// <summary>Core boundary access. All calls go through the single hyper-db resource.</summary>
    public static class Db
    {
        private static string CoreResource => API.GetConvar("hyperdb_resource", "hyper-db");

        private static bool Enabled => API.GetConvar("hyperdb_cs_enabled", "1") != "0";

        private static void EnsureEnabled()
        {
            if (!Enabled)
            {
                throw new HyperDbException(
                    "unsupported_feature",
                    "hyper-db C# client disabled via hyperdb_cs_enabled — use the Lua/TS fallback path");
            }
        }

        /// <summary>Execute a registered static query by id.</summary>
        public static async Coroutine<List<TRow>> Execute<TRow>(string queryId, object[] args) where TRow : new()
        {
            EnsureEnabled();
            var result = await Exports.Local[CoreResource].executeAsync(queryId, args);
            return RowMapper.MapRows<TRow>(result);
        }

        /// <summary>Execute a dynamic chain descriptor.</summary>
        public static async Coroutine<List<TRow>> ExecuteChain<TRow>(string table, string descriptor, object[] args)
            where TRow : new()
        {
            EnsureEnabled();
            var result = await Exports.Local[CoreResource].executeChainAsync(table, descriptor, args);
            return RowMapper.MapRows<TRow>(result);
        }
    }

    internal static class RowMapper
    {
        public static List<TRow> MapRows<TRow>(object result) where TRow : new()
        {
            if (result is IDictionary<string, object> errObj &&
                errObj.TryGetValue("code", out var code) &&
                errObj.TryGetValue("message", out var message))
            {
                throw new HyperDbException(code?.ToString() ?? "query_failed", message?.ToString() ?? "query failed");
            }

            var rows = new List<TRow>();
            if (!(result is IEnumerable<object> list)) return rows;

            var props = typeof(TRow).GetProperties();
            foreach (var item in list)
            {
                if (!(item is IDictionary<string, object> dict)) continue;
                var row = new TRow();
                foreach (var prop in props)
                {
                    // generated DTOs use PascalCase over snake_case/camelCase columns
                    foreach (var key in dict.Keys)
                    {
                        if (!string.Equals(key.Replace("_", string.Empty), prop.Name, StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }
                        var value = dict[key];
                        if (value != null)
                        {
                            var target = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                            prop.SetValue(row, Convert.ChangeType(value, target));
                        }
                        break;
                    }
                }
                rows.Add(row);
            }
            return rows;
        }
    }
}
