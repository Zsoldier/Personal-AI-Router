// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path'
import type { Configuration } from 'electron-builder'
import base from './electron-builder.config'
import { APP_DISPLAY_NAME } from './src/shared/constants/app'
import { macAfterPack } from './scripts/build/macos/hooks'
import { signAndNotarizeForkApp, signAndNotarizeForkDmg } from './scripts/build/macos/signing'

const config: Configuration = {
    ...base,
    artifactName: 'Zsoldier-PAIR-${version}-${arch}.${ext}',
    mac: {
        ...base.mac,
        identity: null,
        notarize: false,
        extendInfo: {
            CFBundleDisplayName: APP_DISPLAY_NAME,
            NSLocalNetworkUsageDescription:
                'Zsoldier PAIR discovers paired computers and routes local AI requests between them.',
            NSBonjourServices: ['_nvpair-node._tcp']
        }
    },
    afterPack: async context => {
        if (context.electronPlatformName !== 'darwin') {
            throw new Error('The signed fork configuration supports macOS only.')
        }
        await macAfterPack(context)
        await signAndNotarizeForkApp(join(context.appOutDir, `${APP_DISPLAY_NAME}.app`))
    },
    afterAllArtifactBuild: async result => {
        for (const artifact of result.artifactPaths) {
            if (artifact.endsWith('.dmg')) signAndNotarizeForkDmg(artifact)
        }
        return result.artifactPaths
    }
}

export default config
