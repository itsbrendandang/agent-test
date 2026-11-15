# j board            run the example brief in the terminal
# j board <brief>    run a specific brief
# j engine           start the engine (dashboard backend); resumes unfinished runs
# j dashboard        open the dashboard in the browser (http://localhost:5317)
default:
    @just --list

setup:
    npm run setup

board brief="board/briefs/kras-g12c-hit-to-lead.md":
    node engine/src/cli.ts run {{brief}}

resume run:
    node engine/src/cli.ts resume {{run}}

runs:
    node engine/src/cli.ts list

engine:
    node engine/src/server.ts

dashboard:
    npm --prefix dashboard run dev

typecheck:
    npm run typecheck
