// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { signAsync, type PerFileSignOptions } from '@electron/osx-sign'

const TEAM_ID = 'U8A2AFWXCM'
const APP_ID = 'com.zsoldier.pair'
const DAEMON_ID = `${APP_ID}.privileged-helper`
const CONTROL_ID = 'nvpair-helper-ctl'
const DEVELOPER_ID_REQUIREMENT =
    'anchor apple generic ' +
    'and certificate 1[field.1.2.840.113635.100.6.2.6] exists ' +
    'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists ' +
    `and certificate leaf[subject.OU] = "${TEAM_ID}"`

function requiredEnvironment(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name} before building the signed fork.`)
    return value
}

function run(command: string, args: string[]): void {
    execFileSync(command, args, { stdio: 'inherit' })
}

export function signingOptionsForFile(filePath: string): PerFileSignOptions {
    const name = basename(filePath)
    if (name === DAEMON_ID || name === CONTROL_ID) {
        return {
            entitlements: [],
            additionalArguments: ['--identifier', name]
        }
    }
    if (filePath.includes('/Contents/Resources/cli-bin/')) {
        return { entitlements: [] }
    }
    return {}
}

function verifySignature(filePath: string, identifier?: string): void {
    const requirement = identifier
        ? `identifier "${identifier}" and ${DEVELOPER_ID_REQUIREMENT}`
        : DEVELOPER_ID_REQUIREMENT
    run('codesign', ['--verify', '--strict', '--all-architectures', '-R', requirement, filePath])
}

function notarize(filePath: string): void {
    run('xcrun', [
        'notarytool',
        'submit',
        filePath,
        '--keychain-profile',
        requiredEnvironment('NOTARY_PROFILE'),
        '--wait'
    ])
}

export async function signAndNotarizeForkApp(appPath: string): Promise<void> {
    const identity = requiredEnvironment('DEVELOPER_ID_APP')
    requiredEnvironment('NOTARY_PROFILE')

    // Signing the Electron executable also validates its sibling helpers.
    // Sign these first rather than relying on traversal order within MacOS/.
    for (const identifier of [DAEMON_ID, CONTROL_ID]) {
        run('codesign', [
            '--force',
            '--options',
            'runtime',
            '--timestamp',
            '--identifier',
            identifier,
            '--sign',
            identity,
            join(appPath, 'Contents/MacOS', identifier)
        ])
    }

    await signAsync({
        app: appPath,
        identity,
        platform: 'darwin',
        type: 'distribution',
        preAutoEntitlements: false,
        optionsForFile: signingOptionsForFile
    })
    verifySignature(appPath, APP_ID)
    verifySignature(join(appPath, 'Contents/MacOS', DAEMON_ID), DAEMON_ID)
    verifySignature(join(appPath, 'Contents/MacOS', CONTROL_ID), CONTROL_ID)
    const cliBin = join(appPath, 'Contents/Resources/cli-bin')
    for (const entry of readdirSync(cliBin, { withFileTypes: true })) {
        if (entry.isFile() && !entry.name.includes('.')) {
            verifySignature(join(cliBin, entry.name))
        }
    }
    run('codesign', ['--verify', '--deep', '--strict', appPath])

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'zsoldier-pair-notary-'))
    try {
        const archive = join(temporaryDirectory, 'Zsoldier-PAIR.zip')
        run('ditto', ['-c', '-k', '--keepParent', appPath, archive])
        notarize(archive)
        run('xcrun', ['stapler', 'staple', appPath])
        run('xcrun', ['stapler', 'validate', appPath])
        run('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath])
    } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true })
    }
}

export function signAndNotarizeForkDmg(dmgPath: string): void {
    run('codesign', [
        '--force',
        '--timestamp',
        '--sign',
        requiredEnvironment('DEVELOPER_ID_APP'),
        dmgPath
    ])
    verifySignature(dmgPath)
    notarize(dmgPath)
    run('xcrun', ['stapler', 'staple', dmgPath])
    run('xcrun', ['stapler', 'validate', dmgPath])
}
