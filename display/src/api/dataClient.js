// Voice Display Data Client
// Simplified version of dashboard data client

import apiClient from './client'

/**
 * Query data from a connection/datasource
 * @param {string} datasourceId - ID of the datasource
 * @param {object} query - Query parameters (raw, type, params)
 * @returns {Promise<object>} Query result with data and source
 */
export async function queryData(datasourceId, query) {
  try {
    const response = await apiClient.request(`/api/connections/${datasourceId}/query`, {
      method: 'POST',
      body: JSON.stringify({ query })
    })

    return {
      data: response.result_set,
      source: 'datasource'
    }
  } catch (error) {
    console.error('Data query error:', error)
    throw new Error(error.message || 'Failed to query data')
  }
}
