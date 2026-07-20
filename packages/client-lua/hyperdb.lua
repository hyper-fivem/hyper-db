-- hyper-db Lua client runtime.
-- Boundary discipline: every call crosses to the core resource as
-- (queryId|table, descriptor?, flat params) — never nested payloads.
-- Async model: coroutine-based :await() (works inside any Citizen thread),
-- with plain callbacks as the opt-out.

HyperDb = {}

local CORE_RESOURCE = GetConvar and GetConvar('hyperdb_resource', 'hyper-db') or 'hyper-db'

---@class HyperDbError
---@field code string
---@field message string

---@class HyperDbPending
---@field await fun(self: HyperDbPending): table
local Pending = {}
Pending.__index = Pending

local function newPending()
  local p = setmetatable({ promise = promise.new() }, Pending)
  return p
end

--- Block the current coroutine until rows arrive; raises HyperDbError tables.
function Pending:await()
  local ok, rows = table.unpack(Citizen.Await(self.promise))
  if not ok then
    error(rows) -- rows is a { code, message } table from the core resource
  end
  return rows
end

local function dispatch(cb, invoke)
  if cb ~= nil then
    invoke(function(err, rows)
      cb(err, rows)
    end)
    return nil
  end
  local pending = newPending()
  invoke(function(err, rows)
    if err ~= nil then
      pending.promise:resolve({ false, err })
    else
      pending.promise:resolve({ true, rows })
    end
  end)
  return pending
end

--- Execute a registered static query.
---@param queryId string
---@param params any[]
---@param cb? fun(err: HyperDbError|nil, rows: table[]|nil)
---@return HyperDbPending|nil
function HyperDb.execute(queryId, params, cb)
  return dispatch(cb, function(done)
    exports[CORE_RESOURCE]:execute(queryId, params or {}, done)
  end)
end

-- Chain builder: assembles the flat descriptor understood by the core
-- resource (w:<col>:<op>;o:<col>:<dir>;l;of) plus a flat params array.

local OPS = {
  ['=='] = 'eq', ['~='] = 'ne',
  ['>'] = 'gt', ['>='] = 'gte',
  ['<'] = 'lt', ['<='] = 'lte',
  ['like'] = 'like',
}

---@class HyperDbChain
local Chain = {}
Chain.__index = Chain

---@param tableName string
---@return HyperDbChain
function HyperDb.chain(tableName)
  return setmetatable({ t = tableName, segments = {}, params = {} }, Chain)
end

---@param col string
---@param op '=='|'~='|'>'|'>='|'<'|'<='|'like'
---@param value any
---@return HyperDbChain
function Chain:where(col, op, value)
  local mapped = OPS[op]
  if mapped == nil then
    error({ code = 'bad_params', message = ('unknown operator %s'):format(tostring(op)) })
  end
  self.segments[#self.segments + 1] = ('w:%s:%s'):format(col, mapped)
  self.params[#self.params + 1] = value
  return self
end

---@param col string
---@param dir? 'asc'|'desc'
---@return HyperDbChain
function Chain:orderBy(col, dir)
  self.segments[#self.segments + 1] = ('o:%s:%s'):format(col, dir or 'asc')
  return self
end

---@param n integer
---@return HyperDbChain
function Chain:limit(n)
  self.segments[#self.segments + 1] = 'l'
  self.params[#self.params + 1] = n
  return self
end

---@param n integer
---@return HyperDbChain
function Chain:offset(n)
  self.segments[#self.segments + 1] = 'of'
  self.params[#self.params + 1] = n
  return self
end

---@param cb? fun(err: HyperDbError|nil, rows: table[]|nil)
---@return HyperDbPending|nil
function Chain:exec(cb)
  local descriptor = table.concat(self.segments, ';')
  local params = self.params
  local tableName = self.t
  return dispatch(cb, function(done)
    exports[CORE_RESOURCE]:executeChain(tableName, descriptor, params, done)
  end)
end

--- Build and await in one step.
---@return table[]
function Chain:await()
  return self:exec():await()
end
