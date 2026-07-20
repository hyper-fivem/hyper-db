fx_version 'cerulean'
game 'gta5'

name 'hyper-db'
description 'PostgreSQL + Redis hybrid, type-safe DB layer for FiveM'
author 'hyper-framework'
version '0.1.0'
repository 'https://github.com/hyper-framework/hyper-db'

-- Node 22 core (FiveM's automatic webpack/yarn builds are deprecated; we ship
-- a prebuilt esbuild bundle)
node_version '22'

server_script 'dist/server.js'
