# Shakudo Architecture

This page describes how Shakudo is put together. For an overview and setup instructions, see the [README](../README.md).

## Processes

Shakudo runs as three processes:

| Process | Role |
|---|---|
| Renderer (Electron window) | Blockly editor, text editor, and the Crucible test UI |
| Main (Node) | Windows, menus, files, the database, and the backend's lifecycle |
| Backend (Java) | Spring Boot server on `localhost` that parses and runs Alloy |

The renderer and main process talk over Electron IPC. The main process talks to the backend over HTTP, as the original Crucible did.

A full diagram is in [`architecture.tex`](architecture.tex). The latest version is v1.2:

![Architecture diagram](images/Soft_Architecture_v1.2-1.png)

## Backend Architecture

Refer to this repository for the API code https://github.com/That1GuyWhoSucks/Shakudo_Crucible_API

The backend is a Spring Boot server (`java/aSketch-API.jar`) that the main process starts at launch. This server listens for specific requests which are set to execute specific Alloy commands and return data to the frontend from the Alloy process.

### Overview

Controllers
| Name | Role |
| AlloyFileController | Responsible for loading and updating files |
| AlloyTestController | Responsible for running tests sent by the frontend |
| PIDController | Responsible for status checks via returning PID |
| ShakudoController | Responsible for running Shakudo's backend |

Models
| Name | Role | Attributes |
| AlloyFile | Stores all Alloy information about a file | String name, String path, ArrayList<Atom> atoms, ArrayList<AlloyFunction> functions |
| AlloyFunction | Stores information about Alloy functions | String label, ArrayList<AlloyParameter> parameters |
| AlloyParamater | Stores information about Alloy parameters | String label, String paramType |
| AlloyRelation | Stores information about Alloy relations | String label, String multiplicity, String type |
| Atom | The Alloy representation of a node | String label, Pos isEnum, Pos isLone, Pos isOne, Pos isSome, Pos isAbstract, ArrayList<AlloyRelation> relations, ArrayList<String> |parents, ArrayList<String> children |

Repository
| Name | Role |
| AlloyFileRepository | Stores all `AlloyFile`'s |
| AlloyTestRepository | Runs a given Alloy file |
| PIDRepository | Returns the PID of the server process |

### Lifecycle

When the jar is run with java 18 or greater it creates a server that listens on port 10121. Logs are printed to the console on every command that is run. For specific logging information Refer to the API code inside the repository.

### REST API

TODO: one entry per endpoint, with the request body, the response body, and error cases. The endpoints used by the main process today are:

| Endpoint | Method | Purpose | Return |
|---|---|---|---|
| `/pid` | GET | Health check and process id | Returns the process ID |
| `/files` | POST | Parse an `.als` file into atoms, relations, and predicates | Returns the parsed Alloy file on success |
| `/files` | GET | Gets all parsed Alloy file data |
| `/tests` | POST | Run an Alloy command against an `.als` file and report whether it is satisfiable | Returns a satisfying instance if possible, otherwise returns `null` |
| `/shakudo` | POST | Run the Shakudo editor's current text (the Run action) | Returns `satisfiable` if the Alloy can be compiled, otherwise returns `not satisfiable` |

### Data Models

TODO: the JSON objects exchanged with the main process, such as atoms, relations, and functions with their parameters.
TBD: What data should be exchanged with main process

### Alloy Integration

The .jar comes bundled with Alloy 6.1 with which the backend uses to be able to parse, analyze, and run Alloy files. The default solver for both Crucible and Shakudo is SAT4J. Every command interacts with Alloy in it's own environment so future commands may be able to deviate if desired.

### Building and Testing

To test the backend use `.\mvnw.cmd spring-boot:run` inside the API directory then run the application to connect to the dev server.
To build the .jar run `.\mvnw.cmd clean package` inside the API directory.

## Where your data lives

You don't need to touch these files. To reset the app, delete `crucible.db` and the `projects/` folder.

```
<app data>/crucible/
├── crucible.db          your saved data (SQLite)
└── projects/
    └── <project name>/
        ├── crucible.als   plain Alloy that Crucible reads to run tests
        └── tests/         test files
```

`<app data>` is:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\my-app` |
| macOS | `~/Library/Application Support/my-app` |
| Linux | `~/.config/my-app` (TODO: update if the data path was moved off NFS homes) |

Your original `.als` files are not stored in this folder. TODO: state whether Save overwrites the original file or a project copy.

## Code layout

| Path | Contents |
|---|---|
| `src/index.tsx` | Sets up the main editor and the Blockly workspaces |
| `src/BlocklyParser.ts` | Parses `.als` files into editable and read-only blocks |
| `src/blocklyContent/` | Blockly block definitions and Alloy code generation |
| `src/crucible/` | The Crucible test UI (React and Mantine) |
| `electron/main.ts` | Windows, menus, file open and save, run |
| `electron/crucibleDb.ts` | Prisma client, projects, and the active project |
| `electron/crucibleHandlers.ts` | IPC handlers for the Crucible UI |
| `electron/crucibleImport.ts` | Imports atoms, relations, and predicates from an `.als` file |
| `electron/crucibleAPI.ts` | Starts the Java backend and sends it HTTP requests |
| `java/` | The backend JAR (`aSketch-API.jar`) |
| `prisma/` | Database schema, migrations, and `template.db` |
| `docs/` | Tutorial, architecture page, and diagram |