/**
 * Data Transform Utilities
 * Applies client-side filters and aggregations to data
 */

const OPERATORS = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  contains: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
  in: (a, b) => Array.isArray(b) ? b.includes(a) : false,
  notIn: (a, b) => Array.isArray(b) ? !b.includes(a) : true,
  isNull: (a) => a === null || a === undefined,
  isNotNull: (a) => a !== null && a !== undefined,
}

function applyFilter(rows, columns, filter) {
  const { field, op, value } = filter
  const colIndex = columns.indexOf(field)
  if (colIndex === -1) return rows

  const operator = OPERATORS[op]
  if (!operator) return rows

  return rows.filter(row => operator(row[colIndex], value))
}

function applyFilters(rows, columns, filters) {
  if (!filters || !Array.isArray(filters) || filters.length === 0) return rows
  return filters.reduce((filtered, filter) => applyFilter(filtered, columns, filter), rows)
}

function applySlidingWindow(rows, columns, slidingWindow) {
  if (!slidingWindow?.duration || !slidingWindow?.timestampCol) return rows

  const colIndex = columns.indexOf(slidingWindow.timestampCol)
  if (colIndex === -1) return rows

  const now = Date.now()
  const windowStartMs = now - (slidingWindow.duration * 1000)

  return rows.filter(row => {
    const tsValue = row[colIndex]
    if (tsValue === null || tsValue === undefined) return false

    let tsMs
    if (typeof tsValue === 'number') {
      tsMs = tsValue > 946684800000 ? tsValue : tsValue * 1000
    } else if (typeof tsValue === 'string') {
      const num = Number(tsValue)
      if (!isNaN(num) && num > 946684800) {
        tsMs = num > 946684800000 ? num : num * 1000
      } else {
        const parsed = new Date(tsValue)
        tsMs = isNaN(parsed.getTime()) ? null : parsed.getTime()
      }
    } else {
      return false
    }

    return tsMs !== null && tsMs >= windowStartMs
  })
}

function sortRows(rows, columns, sortBy, order = 'desc') {
  const colIndex = columns.indexOf(sortBy)
  if (colIndex === -1) return rows

  return [...rows].sort((a, b) => {
    const valA = a[colIndex]
    const valB = b[colIndex]
    if (valA == null && valB == null) return 0
    if (valA == null) return order === 'asc' ? -1 : 1
    if (valB == null) return order === 'asc' ? 1 : -1
    if (valA < valB) return order === 'asc' ? -1 : 1
    if (valA > valB) return order === 'asc' ? 1 : -1
    return 0
  })
}

function applyAggregation(rows, columns, aggregation) {
  if (!aggregation?.type) return { rows, value: null }

  const { type, sortBy, field } = aggregation
  let sortedRows = rows

  if (sortBy && (type === 'first' || type === 'last')) {
    sortedRows = sortRows(rows, columns, sortBy, type === 'last' ? 'desc' : 'asc')
  }

  const fieldIndex = field ? columns.indexOf(field) : -1

  switch (type) {
    case 'first':
    case 'last':
      return {
        rows: sortedRows.slice(0, 1),
        value: fieldIndex >= 0 && sortedRows.length > 0 ? sortedRows[0][fieldIndex] : null
      }
    case 'min':
      if (fieldIndex < 0) return { rows, value: null }
      return { rows, value: Math.min(...rows.map(r => Number(r[fieldIndex]) || 0)) }
    case 'max':
      if (fieldIndex < 0) return { rows, value: null }
      return { rows, value: Math.max(...rows.map(r => Number(r[fieldIndex]) || 0)) }
    case 'sum':
      if (fieldIndex < 0) return { rows, value: null }
      return { rows, value: rows.reduce((acc, r) => acc + (Number(r[fieldIndex]) || 0), 0) }
    case 'avg':
      if (fieldIndex < 0 || rows.length === 0) return { rows, value: null }
      return { rows, value: rows.reduce((acc, r) => acc + (Number(r[fieldIndex]) || 0), 0) / rows.length }
    case 'count':
      return { rows, value: rows.length }
    case 'limit':
      return { rows: sortedRows.slice(0, aggregation.count || 10), value: null }
    default:
      return { rows, value: null }
  }
}

export function transformData(data, transforms = {}) {
  if (!data?.rows || !data?.columns) {
    return { columns: [], rows: [], metadata: {}, aggregatedValue: null }
  }

  const safeTransforms = transforms || {}
  const { filters, aggregation, sortBy, sortOrder, limit, slidingWindow } = safeTransforms

  let rows = [...data.rows]
  const columns = data.columns

  rows = applySlidingWindow(rows, columns, slidingWindow)
  rows = applyFilters(rows, columns, filters)

  if (sortBy && (!aggregation || !aggregation.sortBy)) {
    rows = sortRows(rows, columns, sortBy, sortOrder || 'desc')
  }

  if (limit && (!aggregation || aggregation.type !== 'limit')) {
    rows = rows.slice(0, limit)
  }

  const { rows: aggRows, value: aggregatedValue } = applyAggregation(rows, columns, aggregation)
  rows = aggRows

  return {
    columns,
    rows,
    metadata: {
      ...data.metadata,
      originalRowCount: data.rows.length,
      filteredRowCount: rows.length,
      transformed: true
    },
    aggregatedValue
  }
}

export function toObjects(data) {
  if (!data?.rows || !data?.columns) return []
  return data.rows.map(row => {
    const obj = {}
    data.columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  })
}

export function getValue(data, field) {
  if (!data?.rows?.length || !data?.columns) return null
  const colIndex = data.columns.indexOf(field)
  return colIndex === -1 ? null : data.rows[0][colIndex]
}

export function formatTimestamp(value, format = 'short', options = {}) {
  const { locale = 'en-US' } = options

  let date
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'number') {
    date = new Date(value > 946684800000 ? value : value * 1000)
  } else if (typeof value === 'string') {
    date = new Date(value)
  } else {
    return String(value)
  }

  if (isNaN(date.getTime())) return String(value)

  switch (format) {
    case 'short':
      return date.toLocaleString(locale, { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })
    case 'time':
      return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    case 'time_short':
      return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    case 'date':
      return date.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })
    case 'chart_time':
      return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    default:
      return date.toLocaleString(locale)
  }
}

export function formatCellValue(value, columnName = '') {
  if (value === null || value === undefined) return ''

  const isTimestampColumn = /timestamp|time|date|created|updated|ts$/i.test(columnName)
  if (isTimestampColumn) return formatTimestamp(value)

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  return String(value)
}

export function buildTransformsFromMapping(dataMapping) {
  if (!dataMapping) return null

  const { filters, aggregation, sort_by, sort_order, limit, sliding_window } = dataMapping
  const hasSlidingWindow = sliding_window?.duration > 0 && sliding_window?.timestamp_col
  const hasTransforms = (filters?.length > 0) || aggregation?.type || sort_by || (limit > 0) || hasSlidingWindow

  if (!hasTransforms) return null

  return {
    slidingWindow: hasSlidingWindow ? {
      duration: sliding_window.duration,
      timestampCol: sliding_window.timestamp_col
    } : null,
    filters: (filters || []).map(f => ({
      field: f.field,
      op: f.op,
      value: (f.op === 'in' || f.op === 'notIn') && typeof f.value === 'string'
        ? f.value.split(',').map(v => v.trim())
        : f.value
    })),
    aggregation: aggregation?.type ? aggregation : null,
    sortBy: sort_by || null,
    sortOrder: sort_order || 'desc',
    limit: limit || 0
  }
}

export default transformData
