/**
 * Dynamic Component Loader
 * Loads and renders React components from string code at runtime
 * Simplified version for voice display
 */

import { useState, useEffect, useMemo, useContext, createContext } from 'react'
import * as React from 'react'
import * as echarts from 'echarts'
import ReactECharts from 'echarts-for-react'
import { carbonLightTheme, carbonDarkTheme } from '../theme/carbonEchartsTheme'
import { useData as useDataOriginal } from '../hooks/useData'
import { transformData, toObjects, getValue, formatTimestamp, formatCellValue, buildTransformsFromMapping } from '../utils/dataTransforms'

const TransformsContext = createContext(null)

function useDataWithTransforms(params) {
  const transforms = useContext(TransformsContext)
  const result = useDataOriginal(params)

  const transformedData = useMemo(() => {
    if (!transforms || !result.data) return result.data
    return transformData(result.data, transforms)
  }, [result.data, transforms])

  return {
    ...result,
    data: transformedData,
    rawData: result.data
  }
}

export default function DynamicComponentLoader({
  code,
  props = {},
  dataMapping = null,
  datasourceId = null,
  queryConfig = null,
  dataRefreshInterval = null
}) {
  const [error, setError] = useState(null)
  const [Component, setComponent] = useState(null)

  const effectiveDatasourceId = datasourceId || dataMapping?.datasource_id
  const transforms = useMemo(() => buildTransformsFromMapping(dataMapping), [dataMapping])
  const shouldFetchData = effectiveDatasourceId && !props.data

  const {
    data: fetchedData,
    loading: dataLoading,
    error: dataError,
    isStreaming,
    reconnecting
  } = useDataOriginal({
    datasourceId: shouldFetchData ? effectiveDatasourceId : null,
    query: queryConfig || dataMapping?.query_config || { raw: '', type: 'sql' },
    refreshInterval: dataRefreshInterval
  })

  const transformedFetchedData = useMemo(() => {
    if (!shouldFetchData || !fetchedData) return null
    if (!transforms) return fetchedData
    return transformData(fetchedData, transforms)
  }, [fetchedData, transforms, shouldFetchData])

  useEffect(() => {
    if (!code) {
      setComponent(null)
      setError(null)
      return
    }

    try {
      // Register Carbon themes
      echarts.registerTheme('carbon-light', carbonLightTheme)
      echarts.registerTheme('carbon-dark', carbonDarkTheme)

      // Simple JSX transform (handles basic cases)
      let transformedCode = code
        // Transform JSX elements to React.createElement
        .replace(/<(\w+)([^>]*?)\/>/g, 'React.createElement("$1", {$2})')
        .replace(/<(\w+)([^>]*?)>([\s\S]*?)<\/\1>/g, (match, tag, attrs, children) => {
          return `React.createElement("${tag}", {${attrs}}, ${children || 'null'})`
        })

      // For more complex JSX, we'd need Babel - for now, assume pre-compiled
      // or simple component code that doesn't need transformation

      const componentFunction = new Function(
        'React',
        'useState',
        'useEffect',
        'useMemo',
        'useCallback',
        'useRef',
        'useContext',
        'useData',
        'transformData',
        'toObjects',
        'getValue',
        'formatTimestamp',
        'formatCellValue',
        'echarts',
        'ReactECharts',
        'carbonTheme',
        'carbonDarkTheme',
        `
        ${code}
        return typeof Component !== 'undefined' ? Component :
               typeof Widget !== 'undefined' ? Widget :
               (function() { throw new Error('Component or Widget not found') })();
        `
      )

      const LoadedComponent = componentFunction(
        React,
        React.useState,
        React.useEffect,
        React.useMemo,
        React.useCallback,
        React.useRef,
        React.useContext,
        useDataWithTransforms,
        transformData,
        toObjects,
        getValue,
        formatTimestamp,
        formatCellValue,
        echarts,
        ReactECharts,
        carbonLightTheme,
        carbonDarkTheme
      )

      setComponent(() => LoadedComponent)
      setError(null)
    } catch (err) {
      console.error('Error loading component:', err)
      setError(err.message)
      setComponent(null)
    }
  }, [code])

  if (error) {
    return (
      <div style={{
        padding: 20,
        border: '2px solid #da1e28',
        borderRadius: 4,
        backgroundColor: '#2d0709',
        color: '#fa4d56'
      }}>
        <h4 style={{ margin: '0 0 10px 0', fontWeight: 600 }}>Component Error</h4>
        <pre style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          fontFamily: "'IBM Plex Mono', monospace"
        }}>
          {error}
        </pre>
      </div>
    )
  }

  if (!Component) return null

  if (shouldFetchData && dataLoading && !transformedFetchedData) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#c6c6c6'
      }}>
        <div style={{
          width: 32,
          height: 32,
          border: '3px solid #393939',
          borderTopColor: '#0f62fe',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (shouldFetchData && dataError && !transformedFetchedData) {
    return (
      <div style={{
        padding: 8,
        color: '#fa4d56',
        fontSize: 14
      }}>
        {dataError.message || 'Failed to fetch data'}
      </div>
    )
  }

  const finalProps = shouldFetchData
    ? { ...props, data: transformedFetchedData }
    : props

  return (
    <TransformsContext.Provider value={transforms}>
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        <Component {...finalProps} />
        {shouldFetchData && dataError && transformedFetchedData && reconnecting && (
          <div style={{
            position: 'absolute',
            top: 4,
            right: 4,
            padding: '4px 8px',
            backgroundColor: 'rgba(218, 30, 40, 0.9)',
            borderRadius: 4,
            fontSize: 11,
            color: '#fff'
          }}>
            Reconnecting...
          </div>
        )}
      </div>
    </TransformsContext.Provider>
  )
}
