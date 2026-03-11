/**
 * useData Hook
 * React hook for fetching data from datasources
 * Supports both polling and SSE streaming
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { queryData } from '../api/dataClient'
import apiClient from '../api/client'
import StreamConnectionManager from '../utils/streamConnectionManager'

export function useData({ datasourceId, query, refreshInterval = null, maxBuffer = 1000 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const [datasourceType, setDatasourceType] = useState(null)
  const [typeLoading, setTypeLoading] = useState(true)

  const mountedRef = useRef(true)
  const fetchingRef = useRef(false)
  const intervalRef = useRef(null)
  const columnsRef = useRef([])

  const queryKey = useMemo(() => JSON.stringify(query), [query])

  // Fetch datasource type
  useEffect(() => {
    if (!datasourceId) {
      setTypeLoading(false)
      return
    }

    let cancelled = false

    const fetchType = async () => {
      try {
        const ds = await apiClient.getDatasource(datasourceId)
        if (!cancelled && mountedRef.current) {
          setDatasourceType(ds.type)
          setTypeLoading(false)
        }
      } catch (err) {
        console.error('[useData] Failed to fetch datasource type:', err)
        if (!cancelled && mountedRef.current) {
          setDatasourceType('unknown')
          setTypeLoading(false)
        }
      }
    }

    fetchType()
    return () => { cancelled = true }
  }, [datasourceId])

  // Process streaming record
  const processStreamRecord = useCallback((record) => {
    if (!mountedRef.current) return

    setData((prev) => {
      const prevData = prev || { columns: [], rows: [] }
      let columns = prevData.columns

      if (columns.length === 0) {
        columns = Object.keys(record)
        columnsRef.current = columns
      }

      const row = columns.map(col => record[col])
      let newRows = [...prevData.rows, row]
      if (newRows.length > maxBuffer) {
        newRows = newRows.slice(newRows.length - maxBuffer)
      }

      return { columns, rows: newRows }
    })
  }, [maxBuffer])

  // Connect to SSE stream for socket datasources
  useEffect(() => {
    if (typeLoading || datasourceType !== 'socket' || !datasourceId) return

    mountedRef.current = true
    let unsubscribe = null

    const connectStream = () => {
      const manager = StreamConnectionManager.getInstance()

      const bufferedRecords = manager.getBuffer(datasourceId)
      if (bufferedRecords.length > 0) {
        bufferedRecords.forEach(record => {
          if (mountedRef.current) processStreamRecord(record)
        })
      }

      unsubscribe = manager.subscribe(
        datasourceId,
        (record) => {
          if (mountedRef.current) processStreamRecord(record)
        },
        {
          onConnect: () => {
            if (mountedRef.current) {
              setConnected(true)
              setReconnecting(false)
              setError(null)
              setLoading(false)
              setSource('stream')
            }
          },
          onDisconnect: () => {
            if (mountedRef.current) setConnected(false)
          },
          onReconnecting: () => {
            if (mountedRef.current) setReconnecting(true)
          }
        }
      )

      const status = manager.getStatus(datasourceId)
      if (status.connected) {
        setConnected(true)
        setLoading(false)
        setSource('stream')
      }
    }

    connectStream()

    return () => {
      mountedRef.current = false
      if (unsubscribe) unsubscribe()
    }
  }, [datasourceId, datasourceType, typeLoading, processStreamRecord])

  // Fetch data for non-socket datasources
  const fetchData = useCallback(async () => {
    if (!datasourceId || !query) {
      setError(new Error('datasourceId and query are required'))
      setLoading(false)
      return
    }

    if (fetchingRef.current) return
    fetchingRef.current = true

    try {
      setError(null)
      const result = await queryData(datasourceId, query)

      if (mountedRef.current) {
        setData(result.data)
        setSource(result.source)
        setLoading(false)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err)
        setLoading(false)
      }
    } finally {
      fetchingRef.current = false
    }
  }, [datasourceId, queryKey])

  // Initial fetch for non-socket datasources
  useEffect(() => {
    if (typeLoading || datasourceType === 'socket' || !datasourceId) return

    mountedRef.current = true
    setLoading(true)
    fetchData()

    return () => { mountedRef.current = false }
  }, [datasourceId, queryKey, datasourceType, typeLoading, fetchData])

  // Auto-refresh for non-socket datasources
  useEffect(() => {
    if (typeLoading || datasourceType === 'socket') return

    if (refreshInterval && refreshInterval > 0) {
      intervalRef.current = setInterval(fetchData, refreshInterval)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }
  }, [refreshInterval, fetchData, datasourceType, typeLoading])

  const refetch = useCallback(async () => {
    if (datasourceType === 'socket') {
      setData({ columns: columnsRef.current, rows: [] })
      return
    }
    await fetchData()
  }, [datasourceType, fetchData])

  const clearBuffer = useCallback(() => {
    setData({ columns: columnsRef.current, rows: [] })
  }, [])

  return {
    data,
    loading: typeLoading || loading,
    error,
    refetch,
    source: datasourceType === 'socket' ? 'stream' : source,
    connected: datasourceType === 'socket' ? connected : null,
    isStreaming: datasourceType === 'socket',
    clearBuffer: datasourceType === 'socket' ? clearBuffer : null,
    reconnecting: datasourceType === 'socket' ? reconnecting : false,
  }
}
