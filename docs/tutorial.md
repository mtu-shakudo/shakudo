# Shakudo Tutorial
 
This tutorial walks through building a predicate with blocks and then testing it. It uses the example file `examples/kittehLab.als`, so you can follow along step by step. For installation and setup, see the [README](README.md).
 
> TODO: Screenshots and GIFs are placeholders for now. Add them to `docs/images/` using the file names below.
 
## Contents
 
1. [Create a Project](#create-a-project)
2. [Build a Predicate with Blocks](#build-a-predicate-with-blocks)
3. [Compile](#compile)
4. [Create a Test](#create-a-test)
5. [Run a Test](#run-a-test)
6. [Fix a Bug with Tests](#fix-a-bug-with-tests)
7. [Split into Two Windows](#split-into-two-windows)
8. [Save](#save)
9. [Keyboard Shortcuts](#keyboard-shortcuts)
## Create a Project
 
When you launch Shakudo, you'll see the project selection screen. Choose **New Project**, enter a name, and pick an existing `.als` file. You can also use **File > Open** (`Ctrl/Cmd+O`) to open a file directly, which creates a project for it automatically.
 
![Creating a project](docs/images/new_project.gif)
 
If the file has no Shakudo formatting, Shakudo converts it when it opens. TODO: describe what the converted file looks like.
 
## Build a Predicate with Blocks
 
Each editable predicate gets its own tab on the right. Select a tab and drag blocks from the toolbox into the workspace to build the predicate. Signatures and predicates defined in the lab file appear at the top of the toolbox, followed by quantifiers and operators.
 
![Building a predicate from blocks](docs/images/build_predicate.gif)
 
To create a local variable, use **Create a local variable** in the toolbox. Variables you create are saved with the workspace.
 
## Compile
 
Press `Ctrl/Cmd+Shift+C` (**File > Compile Current Tab**) to turn your blocks into Alloy. The generated code replaces the predicate's body in the text editor on the left. If the blocks are incomplete, Shakudo highlights the block that's missing an input.
 
![Compiling blocks into Alloy](docs/images/compile.gif)

## Run Your Predicate (not the test yet)

Press `Ctrl/Cmd+Shift+R` (**File > Run**) to run the Alloy Analyzer on the code inside of the editor. This will open
an Alloy window, showing you instances that satisfy your contraints. Pleasre refer to Alloy's official documentation to learn more about how to interact with the opened window.

![Running genereated Alloy](docs/images/run_alloy.gif)
 
## Create a Test
 
Switch to the test view with `Ctrl/Cmd+Shift+T` (**File > Test**). Open the test drawer using the test tube icon on the left, then select **New Test** and give the test a name.
 
![Creating a test](docs/images/create_test.gif)
 
Selecting the test opens its canvas. Open the atoms drawer and drag atoms onto the canvas. Then drag from the connection node on one atom to another to add a relation. Valid targets are highlighted green, and Shakudo warns you if a connection would break a multiplicity constraint.
 
![Adding atoms and connections](docs/images/add_atoms.gif)
 
## Run a Test (not to be confused with running the generated Alloy)
 
Click the green **Run** button in the upper left of the canvas. A notification tells you whether the test passed or failed. The test runs against the current text in the editor, so you don't need to save first.
 
![Running a test](docs/images/run_test.gif)
 
Use the purple **Predicates** button next to **Run** to mark a predicate **Valid** or **Invalid** for the test. Predicates start disabled. Once you set one, the test checks that your atoms and connections do (or don't) satisfy it. Predicates with parameters need an atom chosen for each one.
 
![Setting a predicate's state](docs/images/predicates.gif)
 
## Fix a Bug with Tests
 
Tests are most useful for finding mistakes in a formula that looks correct. Build one test that should satisfy your predicate and one that shouldn't. If either result surprises you, go back to the block editor, adjust the blocks, compile, and rerun.
 
![Test, fix, rerun](docs/images/fix_bug.gif)
 
## Split into Two Windows
 
If you want the blocks and the tests side by side, pop the test view out into its own window. TODO: add the menu item or button name. Closing the test window returns the tests to the main window.
 
![Split view](docs/images/split_view.png)
 
## Save
 
Press `Ctrl/Cmd+S` to save. Switching projects or closing the window with unsaved changes asks whether to save first.
 
## Keyboard Shortcuts
 
| Action | Shortcut |
|---|---|
| Open a file | `Ctrl/Cmd+O` |
| Save | `Ctrl/Cmd+S` |
| Run | `Ctrl/Cmd+R` |
| Compile current tab | `Ctrl/Cmd+Shift+C` |
| Show the block editor | `Ctrl/Cmd+Shift+W` |
| Show the tests | `Ctrl/Cmd+Shift+T` |