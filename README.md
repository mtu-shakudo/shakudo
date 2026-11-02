# Shakudo
 
Shakudo is a graphical interface to the [Alloy Analyzer](https://alloytools.org/), built to provide scaffolding while teaching early discrete mathematics. It uses [Blockly](https://developers.google.com/blockly) for a drag-and-drop predicate editor, and integrates [Crucible](https://github.com/Crucible-Alloy/Crucible) for building and running graphical unit tests of those predicates.
 
Instructors write lab files that define signatures and predicates. Students build the predicates from blocks, then write tests (atoms and relations placed on a canvas) to check that a predicate means what they intend.
 
Crucible was built as a standalone tool for [AUnit](https://kaiyuanw.github.io/papers/paper5-icst18.pdf), a unit testing framework for Alloy. Merging Shakudo and Crucible was a Senior Design II project (CS 4792, Fall 2026).
 
## Documentation
 
- [Tutorial](docs/tutorial.md): getting started, step by step.
- [Architecture](docs/architecture.md): how the processes fit together, where data lives, and how the code is laid out.
## Features
 
- **Block editor:** build Alloy predicates with Blockly. Compiling regenerates the Alloy in the text editor.
- **Test builder:** create tests by dragging atoms onto a canvas and connecting them with relations, then set each predicate to valid or invalid and run the test.
- **Projects:** each project wraps one `.als` file, its tests, and its saved state. Projects are chosen from a start screen and under the File menu.
- **Plain `.als` import:** if a file has no Shakudo formatting, it is converted to Shakudo format when opened. TODO: document what the conversion produces.
- **Split view:** the block editor and the test view can share one window or be popped out into two.
- **Safe re-import:** if an `.als` file's structure changes (signatures, relations, predicate names or parameters), Shakudo asks before clearing the tests that depended on it. Editing a predicate's body never triggers this.
## Download
 
Download the latest build for your platform from the [releases]() page. TODO: add link.
 
- **Windows:** run the installer or `.exe`. Windows SmartScreen may warn about an unsigned app. Choose "More info", then "Run anyway".
- **Linux / macOS:** make the file executable first (`chmod +x`). On Linux you may need to launch with `--no-sandbox`.
- **All platforms:** [Java](https://adoptium.net/) must be installed and on your `PATH`. Shakudo starts a Java backend on launch. TODO: confirm the minimum Java version.
## Development
 
Shakudo has three processes (renderer, main, and a Java backend). See [Architecture](docs/architecture.md) before changing code that crosses them.
 
**Requirements**
 
- Node 15.14.0. Newer versions don't work yet, so use [`nvm`](https://github.com/nvm-sh/nvm).
- [Yarn](https://yarnpkg.com/) 1.x (`npm i -g yarn`)
- Java (a JDK, to rebuild the backend)
**Setup and run**
 
```
yarn install --ignore-engines
npx prisma generate
yarn electron:dev
```
 
Quit the app by closing its window before pressing Ctrl+C in the terminal. This lets Shakudo stop the Java backend. On Windows, a leftover process on port 10121 can be cleared with `netstat -ano | findstr 10121` and `taskkill /PID <pid> /F`.
 
**Changing the database schema**
 
```
npx prisma migrate dev --name <change>
```
 
Then delete `crucible.db` from your app data folder so a fresh copy of `template.db` is used.
 
**Building the backend**
 
TODO: document how to build `aSketch-API.jar` (`mvnw package`), and where the merged source lives.
 
**Building a release**
 
TODO: GitHub Actions. By hand, build on the target platform:
 
```
yarn build
npx prisma generate
npx tsc -p electron
# copy electron/generated to build/electron/generated
npx electron-builder
```
 
## Credits
 
**Shakudo**
- Sam VanderArk: [email](mailto:sjvander@mtu.edu), [github](https://github.com/SamV-42/)
- Elijah Cobb: [email](mailto:elijah@elijahcobb.com), [website](https://elijahcobb.com), [github](https://github.com/elijahjcobb)

**Crucible**
- Adam Emerson: [github](https://github.com/AdamGEmerson)

**Shakudo-Crucible integration** (CS 4792, Fall 2026)
- Kyler Hillstrom: [github](https://github.com/KylerHil)
- Zack Latusek: [github](https://github.com/That1GuyWhoSucks)
- Cade Haas: [github](https://github.com/cade-Haas)
- Caden Rose: [github](https://github.com/cadenjrose)