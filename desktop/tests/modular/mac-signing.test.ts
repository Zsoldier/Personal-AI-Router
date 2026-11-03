// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signAsync } from '@electron/osx-sign'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signAndNotarizeForkApp, signingOptionsForFile } from '../../scripts/build/macos/signing'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn<typeof execFileSync>() }))
vi.mock('@electron/osx-sign', () => ({ signAsync: vi.fn<typeof signAsync>() }))

describe('fork macOS signing', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('signs both Swift helpers before Electron validates the enclosing bundle', async () => {
        vi.stubEnv('DEVELOPER_ID_APP', 'test-identity')
        vi.stubEnv('NOTARY_PROFILE', 'test-profile')
        const stoppedBeforeNotarization = new Error('stop before real filesystem access')
        vi.mocked(signAsync).mockImplementationOnce(async () => {
            expect(vi.mocked(execFileSync).mock.calls.map(call => call[1])).toEqual([
                [
                    '--force',
                    '--options',
                    'runtime',
                    '--timestamp',
                    '--identifier',
                    'com.zsoldier.pair.privileged-helper',
                    '--sign',
                    'test-identity',
                    '/build/Zsoldier PAIR.app/Contents/MacOS/com.zsoldier.pair.privileged-helper'
                ],
                [
                    '--force',
                    '--options',
                    'runtime',
                    '--timestamp',
                    '--identifier',
                    'nvpair-helper-ctl',
                    '--sign',
                    'test-identity',
                    '/build/Zsoldier PAIR.app/Contents/MacOS/nvpair-helper-ctl'
                ]
            ])
            throw stoppedBeforeNotarization
        })

        await expect(signAndNotarizeForkApp('/build/Zsoldier PAIR.app')).rejects.toThrow(
            stoppedBeforeNotarization
        )
    })

    it('passes inline Developer ID requirements to codesign rather than interpreting them as filenames', async () => {
        vi.stubEnv('DEVELOPER_ID_APP', 'test-identity')
        vi.stubEnv('NOTARY_PROFILE', 'test-profile')
        vi.mocked(signAsync).mockResolvedValueOnce()
        const appPath = mkdtempSync(join(tmpdir(), 'pair-signing-test-'))
        try {
            mkdirSync(join(appPath, 'Contents/Resources/cli-bin'), { recursive: true })

            await signAndNotarizeForkApp(appPath)

            const verifications = vi
                .mocked(execFileSync)
                .mock.calls.filter(call => call[0] === 'codesign' && call[1]?.includes('-R'))
            expect(verifications).toHaveLength(3)
            for (const [, args] of verifications) {
                const requirement = args?.[args.indexOf('-R') + 1]
                expect(requirement).toMatch(/^=identifier "/)
                expect(requirement).toContain('anchor apple generic')
                expect(requirement).toContain('certificate leaf[subject.OU] = "U8A2AFWXCM"')
            }
        } finally {
            rmSync(appPath, { recursive: true, force: true })
        }
    })

    it('explicitly pins the privileged helper identifier instead of inheriting the app identifier', () => {
        const options = signingOptionsForFile(
            '/build/Zsoldier PAIR.app/Contents/MacOS/com.zsoldier.pair.privileged-helper'
        )

        expect(options.additionalArguments).toEqual([
            '--identifier',
            'com.zsoldier.pair.privileged-helper'
        ])
        expect(options.entitlements).toEqual([])
    })

    it('preserves the control tool identifier required by inbound XPC verification', () => {
        const options = signingOptionsForFile(
            '/build/Zsoldier PAIR.app/Contents/MacOS/nvpair-helper-ctl'
        )

        expect(options.additionalArguments).toEqual(['--identifier', 'nvpair-helper-ctl'])
    })

    it('retains Electron signing defaults without granting its entitlements to Go services', () => {
        expect(
            signingOptionsForFile(
                '/build/Zsoldier PAIR.app/Contents/Frameworks/Electron Framework.framework'
            )
        ).toEqual({})
        expect(
            signingOptionsForFile(
                '/build/Zsoldier PAIR.app/Contents/Resources/cli-bin/nvpair-node-scanner'
            ).entitlements
        ).toEqual([])
    })
})
