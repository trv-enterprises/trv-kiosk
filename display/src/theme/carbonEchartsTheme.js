/**
 * Carbon Design System ECharts Theme
 * Dark mode optimized for display
 */

const carbonColors = {
  // Data visualization palette (categorical)
  blue60: '#0f62fe',
  purple60: '#8a3ffc',
  cyan50: '#1192e8',
  teal50: '#009d9a',
  magenta60: '#d02670',
  green50: '#24a148',
  orange40: '#ff832b',
  yellow30: '#f1c21b',
  red50: '#fa4d56',

  // Additional shades
  blue50: '#4589ff',
  blue70: '#0043ce',
  purple50: '#a56eff',
  cyan40: '#33b1ff',
  teal40: '#08bdba',
  green40: '#42be65',

  // UI colors
  gray10: '#f4f4f4',
  gray20: '#e0e0e0',
  gray30: '#c6c6c6',
  gray50: '#8d8d8d',
  gray70: '#525252',
  gray90: '#262626',
  gray100: '#161616',

  white: '#ffffff',
  black: '#000000',
}

const categoricalPalette = [
  carbonColors.blue60,
  carbonColors.purple60,
  carbonColors.cyan50,
  carbonColors.teal50,
  carbonColors.magenta60,
  carbonColors.green50,
  carbonColors.orange40,
  carbonColors.yellow30,
  carbonColors.red50,
  carbonColors.blue50,
  carbonColors.purple50,
  carbonColors.cyan40,
]

// Dark mode theme (primary for voice display)
export const carbonDarkTheme = {
  color: categoricalPalette,
  backgroundColor: carbonColors.gray100,

  textStyle: {
    fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    color: carbonColors.gray10,
  },

  title: {
    textStyle: {
      fontWeight: 600,
      color: carbonColors.gray10,
      fontSize: 16,
    },
    subtextStyle: {
      color: carbonColors.gray30,
      fontSize: 14,
    },
    top: 8,
    left: 'center',
  },

  grid: {
    top: 30,
    left: '1.5%',
    right: '2%',
    bottom: '1.5%',
    containLabel: true,
  },

  line: {
    itemStyle: { borderWidth: 2 },
    lineStyle: { width: 2 },
    symbolSize: 6,
    symbol: 'circle',
    smooth: false,
  },

  bar: {
    itemStyle: {
      barBorderWidth: 0,
      barBorderColor: carbonColors.gray90,
    },
  },

  pie: {
    itemStyle: {
      borderWidth: 1,
      borderColor: carbonColors.gray100,
    },
  },

  scatter: {
    itemStyle: {
      borderWidth: 0,
      borderColor: carbonColors.gray70,
    },
  },

  gauge: {
    itemStyle: { borderWidth: 0 },
    axisLine: {
      lineStyle: {
        color: [
          [0.3, carbonColors.green50],
          [0.7, carbonColors.yellow30],
          [1, carbonColors.red50],
        ],
        width: 8,
      },
    },
    axisTick: { lineStyle: { color: carbonColors.gray50 } },
    axisLabel: { color: carbonColors.gray30 },
    detail: { color: carbonColors.gray10 },
  },

  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: carbonColors.gray70 } },
    axisTick: { show: false },
    axisLabel: { show: true, color: carbonColors.gray30 },
    splitLine: { show: false, lineStyle: { color: [carbonColors.gray90] } },
    splitArea: { show: false },
  },

  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true, color: carbonColors.gray30 },
    splitLine: { show: true, lineStyle: { color: [carbonColors.gray90] } },
    splitArea: { show: false },
  },

  timeAxis: {
    axisLine: { show: true, lineStyle: { color: carbonColors.gray70 } },
    axisTick: { show: false },
    axisLabel: { show: true, color: carbonColors.gray30 },
    splitLine: { show: false, lineStyle: { color: [carbonColors.gray90] } },
    splitArea: { show: false },
  },

  legend: {
    top: 28,
    left: 'center',
    textStyle: { color: carbonColors.gray30 },
    pageIconColor: carbonColors.blue50,
    pageIconInactiveColor: carbonColors.gray70,
    pageTextStyle: { color: carbonColors.gray30 },
  },

  tooltip: {
    backgroundColor: 'rgba(244, 244, 244, 0.95)',
    borderColor: carbonColors.gray30,
    borderWidth: 1,
    textStyle: { color: carbonColors.gray100 },
    axisPointer: {
      lineStyle: { color: carbonColors.gray50, width: 1 },
      crossStyle: { color: carbonColors.gray50, width: 1 },
    },
  },

  dataZoom: {
    backgroundColor: 'rgba(38,38,38,0.3)',
    dataBackgroundColor: carbonColors.gray90,
    fillerColor: 'rgba(15,98,254,0.15)',
    handleColor: carbonColors.blue60,
    handleSize: '100%',
    textStyle: { color: carbonColors.gray30 },
    borderColor: carbonColors.gray70,
  },

  visualMap: {
    textStyle: { color: carbonColors.gray30 },
    inRange: {
      color: [carbonColors.blue50, carbonColors.blue60, carbonColors.blue70],
    },
  },
}

// Light mode theme (for reference)
export const carbonLightTheme = {
  color: categoricalPalette,
  backgroundColor: carbonColors.white,

  textStyle: {
    fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    color: carbonColors.gray100,
  },

  title: {
    textStyle: {
      fontWeight: 600,
      color: carbonColors.gray100,
      fontSize: 16,
    },
    subtextStyle: {
      color: carbonColors.gray70,
      fontSize: 14,
    },
    top: 8,
    left: 'center',
  },

  grid: {
    top: 30,
    left: '1.5%',
    right: '2%',
    bottom: '1.5%',
    containLabel: true,
  },

  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: carbonColors.gray30 } },
    axisTick: { show: false },
    axisLabel: { show: true, color: carbonColors.gray70 },
    splitLine: { show: false },
  },

  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true, color: carbonColors.gray70 },
    splitLine: { show: true, lineStyle: { color: [carbonColors.gray20] } },
  },

  legend: {
    top: 28,
    left: 'center',
    textStyle: { color: carbonColors.gray70 },
  },

  tooltip: {
    backgroundColor: 'rgba(22, 22, 22, 0.9)',
    borderColor: carbonColors.gray70,
    borderWidth: 1,
    textStyle: { color: carbonColors.white },
  },
}

// Default export (dark theme for display)
export default carbonDarkTheme
