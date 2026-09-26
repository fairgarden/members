import type { NextConfig } from 'next'
import { withMonolithicPortability } from '@fairgarden/monolith'
// import localesPlugin from '@react-aria/optimize-locales-plugin'

const nextConfig: NextConfig = {
  rewrites: async () => {
    return {
      // beforeFiles: [
      //   {
      //     source: '/:path*',
      //     has: [{ type: 'query', key: '__nextLocale' }],
      //     destination: '/:__nextLocale/:path*?__nextLocale=:__nextLocale',
      //   },
      // ],
      // afterFiles: [
      //   {
      //     source: '/:path*',
      //     has: [{ type: 'query', key: '__nextLocale' }],
      //     destination: '/:__nextLocale/:path*?__nextLocale=:__nextLocale',
      //   },
      // ],
      // fallback: [
      //   {
      //     source: '/:path*',
      //     has: [{ type: 'query', key: '__nextLocale' }],
      //     destination: '/:__nextLocale/:path*?__nextLocale=:__nextLocale',
      //   },
      // ],
    }
  },
  // webpack(config, { isServer }) {
  //   if (!isServer) {
  //     config.plugins.push(localesPlugin.webpack({ locales: ['en-US'] }))
  //   }
  //   return config
  // },
}

// Reports anything a monolith could not mount.
export default withMonolithicPortability(nextConfig)
