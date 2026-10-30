import Blockly from "blockly"
import {ParseBlock} from "./BlocklyParser"
//import JSON

// block definitions -- defined at the bottom of this file
var block_defs;
var gen_pred_thing, gen_inline_arg_pred_thing;
var fixed_var_def_func, create_var_def_func, quant_def_func, un_op_def_func, bin_op_def_func, compare_op_def_func, set_bin_op_def_func;

// function implementations in setupBlocks
export var quant_list  = ["all", "some", "one", "lone", "no"];
export var un_op_list  = ["not"];
export var bin_op_list = ["and", "or", "implies", "iff"];
export var compare_op_list = ["=", "!="];  // todo: human-friendly words (dict?)
export var set_bin_op_list = [ "-", ["+", "union"], ["&", "intersect"] ]

// misc
var op_internal_translate;

/*
Extremely important: at the moment, I'm distinguishing between variables
  (eg a locally-bound var in a quantifier) and sets (eg a predefined signature).
I think Alloy doesn't really make a distinction in type, but I think for our
  purposes it's good to separate them for student typechecking

Other notes: as of this comment, predef_var isn't actually used (intended to be
  for eg if an instructor wants to insert code inside a quantifier... although
  ineditable predefined blocks might be a better solution there).
*/

// TYPE: 'var'   -- the two subcategories below are for the getter blocks
export var var_types = [ "predef_var", "bound_var" ];
export var fixed_var_types = [ "predef_var" ];       // subset of var_types
export var creatable_var_types = [ "bound_var" ];   // subset of var_types

// TYPE: 'set'  -- the type of sigs, as well as sig ops (eg A intersect B)
export var set_types = [ "predef_set" ]
export var fixed_set_types = [ "predef_set" ]
  // can't currently create set vars

// TYPE: actually none yet, vertical connections are boolean-valued and
//   there's nothing else at the moment so no need for type checking
export var expr_types = [ "statement_expr" ];


// for the sake of checking if vars are bound
export var binding_blocks = quant_list;
export var set_op_blocks = set_bin_op_list;

// ---------------------------------------------------------

export const Alloy = new Blockly.Generator('Alloy');

Alloy.addReservedWords( // https://alloytools.org/spec.html
  "abstract,after,all,always,and,as,assert,before,but,check,disj,else,enabled,event,eventually,exactly,extends,fact,for,fun,historically,iden,iff,implies,in,Int,invariant,let,lone,modifies,module,no,none,not,once,one,open,or,pred,releases,run,set,sig,since,some,steps,sum,triggered,univ,until,var"
)

Alloy.init = function(workspace) {
  Object.getPrototypeOf(this).init.call(this);

  if (!this.nameDB_) {    this.nameDB_ = new Blockly.Names(this.RESERVED_WORDS_);   }
  else {                  this.nameDB_.reset();   }
  this.nameDB_.setVariableMap(workspace.getVariableMap());
  this.nameDB_.populateVariables(workspace);
  this.nameDB_.populateProcedures(workspace);  // idk what this does, exactly
  this.isInitialized = true;
};

Alloy.finish = function(code) {
  code = Object.getPrototypeOf(this).finish.call(this, code);
  this.isInitialized = false;
  this.nameDB_.reset();
  return code;
}

// https://blocklycodelabs.dev/codelabs/custom-generator/index.html
Alloy.scrub_ = function(block, code, opt_thisOnly) {
  const nextBlock = block.nextConnection && block.nextConnection.targetBlock();
  let nextCode = '';
  if (nextBlock)  {
    nextCode = opt_thisOnly ? '' : Alloy.blockToCode(nextBlock);
  }
  return code + nextCode;
};


// ---------------------------------------------------------


/**
 * Set up all the blocks, for each editable section.
 */
export function setupBlocks(): Blockly.Toolbox {
  let upd_block_defs = [...block_defs];

  // 'get' functions -- happen to overlap for the local, fixed, and pred types
  let get_func = function(block) {
    var value = Alloy.nameDB_.getName(block.getFieldValue('VAR'), 'VARIABLE');  // assuming bars, not procedures, eh
    var code = value;
    return [code, 0];   // precedence goes here, later
  }

  // Add the user local variables getter block type
    // (currently, creating a different block type for each distinct 'type' of local var)
  for(let var_type of creatable_var_types) {
    upd_block_defs.push( create_var_def_func(var_type) );
    Alloy['get_' + var_type] = get_func;
  }

  // add the block type for fixed variables (not that any exist yet)
  for(let var_type of fixed_var_types) {
    upd_block_defs.push( fixed_var_def_func(var_type, "var") );
    Alloy['fixed_get_' + var_type] = get_func;
  }

  // add the block type for fixed sets (eg sigs)
  for(let var_type of fixed_set_types) {
    upd_block_defs.push( fixed_var_def_func(var_type, "set") );
    Alloy['fixed_get_' + var_type] = get_func;
  }

  // add the block for fixed predicates
      // there's one type for each 'size' (# args); there may be a a better way
      // update: there is a better way, see the generators in blockly package
      //  changing to that format is low priority since this works fine for now
  var MAX_PREDICATE_SIZE = 10;  // again, there should be a better way than this...

  function pred_resp_function(n) {
    return function(block) {
      let code = Alloy.nameDB_.getName(block.getFieldValue('VAR'), 'VARIABLE') + "[";

      let inputList = [];
      for(let i = 0; i < n; ++i) {
        var condn = Alloy.valueToCode(block, 'param_' + i, 0) || " ";
        inputList.push(condn);
      }
      code += inputList.join(", ");
      code += "]";
      return code;
    }
  }
  for(let n = 0; n <= MAX_PREDICATE_SIZE; ++n) {
    let block_type = `fixed_pred_${n}`;
    let block_def = gen_pred_thing(n, block_type);
    upd_block_defs.push( block_def );
    Alloy[block_type] = pred_resp_function(n)
  }
  // There is currently no way to mix inline and normal inputs
  // and it's currently not worth the effort to cludge up something broken
  // so, no more than 2 inputs: the inline first one and the second one (ig)
  for(let n = 0; n <= 2; ++n) {
    let block_type = `fixed_pred_inline_${n}`;
    let block_def = gen_inline_arg_pred_thing(n, block_type);
    upd_block_defs.push( block_def );
    Alloy[block_type] = pred_resp_function(n)
  }

  // formula quantifiers, aka that evaluate to a boolean, eg all k: Kitteh | pred(k)
  function quant_func(inp_str) {
    Alloy[inp_str] = function(block) {
      var substatements = Alloy.statementToCode(block, 'statement');
      var source_set = Alloy.valueToCode(block, 'condition', 0) || " ";
      var variable = Alloy.nameDB_.getName(block.getFieldValue('NAME'), 'VARIABLE');

      var code = inp_str + ' ' + variable + ': ' + source_set + ' {\n'
      + substatements;
      if(substatements[substatements.length - 1] !== "\n") code += "\n";
      code += "}";
      return code ;//+ "\n";
    };
    upd_block_defs.push(quant_def_func(inp_str));
  };
  quant_list.forEach( quant_func );


  // wrap in parens if it has children... overnethusiastic but should be
  //   good enough for now, without wrapping literally everything
  function _wrapper(block, statement, func) {
    var content = func(block, statement);
    if(block.getChildren().length > 0 && block.getChildren()[0].getChildren().length > 0) {
      content = '( ' + content + ' )';
    }
    return content;
  };
  var wrap_state = (block, statement) => _wrapper(block, statement, (b,s) => Alloy.statementToCode(b,s)  );
  var wrap_value = (block, statement) => _wrapper(block, statement, (b, s) => Alloy.valueToCode(b, s, 0) || " " );


  // unary formula operators
  function un_op_func(inp_str) {
    Alloy[inp_str] = function(block) {
      let left = wrap_state(block, "statement")
      return inp_str + ' ' + left;
    };
    upd_block_defs.push(un_op_def_func(inp_str));
  }
  un_op_list.forEach( un_op_func );

  // binary formula operators
  function bin_op_func(inp_str) {
    Alloy[inp_str] = function(block) {
      var left = wrap_state(block, 'left_statement');
      var right = wrap_state(block, 'right_statement');
      var code = left + ' ' + inp_str + ' ' + right;
      return code;
    };
    upd_block_defs.push(bin_op_def_func(inp_str));
  }
  bin_op_list.forEach( bin_op_func );

  function compare_op_func(inp_str) {
    Alloy[inp_str] = function(block) {
      var left  = wrap_value(block, 'left_value');
      var right = wrap_value(block, 'right_value');
      var code = left + ' ' + inp_str + ' ' + right;
      return code;
    };
    upd_block_defs.push(compare_op_def_func(inp_str));
  }
  compare_op_list.forEach( compare_op_func ); // currently the same function

  function set_bin_op_func(inp_) {
    const [inp_str, inp_label] = op_internal_translate(inp_);
    Alloy[inp_str] = function(block) {
      var left  = wrap_value(block, 'left_value');
      var right = wrap_value(block, 'right_value');
      var code = left + ' ' + inp_str + ' ' + right;
      return [code, 0];
    };
    upd_block_defs.push(set_bin_op_def_func(inp_str, inp_label));
  }
  set_bin_op_list.forEach( set_bin_op_func ); // currently the same function

	Blockly.defineBlocksWithJsonArray(upd_block_defs);
};


// ---------------------------------------------------------

// @shakudo-hide words: a group hides all of its operators, or name one operator by its toolbox name
const opName = (op) => (Array.isArray(op) ? op[1] : op);   // ["+", "union"] -> "union"
export const hide_groups = {
  quantifiers: quant_list,
  boolean: [...bin_op_list, ...un_op_list, ...compare_op_list],
  set: set_bin_op_list,
};

/*
 * Defines the presence and appearance of the blocks in each toolbox
 */
export function setupToolboxContents(block: ParseBlock, hidden = []) {
  const known = ["variables", ...Object.keys(hide_groups), ...Object.values(hide_groups).flat().map(opName)];
  for(const word of hidden) {
    if(!known.includes(word)) console.warn(`@shakudo-hide: unknown word "${word}"; use one of: ${known.join(" ")}`);
  }
  const isHidden = (op) =>
    hidden.includes(opName(op)) || Object.entries(hide_groups).some(([group, ops]) => hidden.includes(group) && ops.includes(op));
  const shown = (list) => list.filter(op => !isHidden(op));

  var toolbox = {
    "kind": "flyoutToolbox",
    "contents": [],
  };

  toolbox["contents"] = [ {"kind": "label", "text": "Predefined Signatures:", "web-class": "toolbox_style", } ];
  toolbox["contents"].push(...(block.fixed_set_names.map( vname => { return {
    "kind": "block",
    "type": "fixed_get_predef_set",
    "fields": {
      "VAR": vname,
    },
  }; })));

  toolbox["contents"].push(...[ {"kind": "label", "text": "Predefined Predicates:", "web-class": "toolbox_style", } ]);
  // TODO: Enforce types; implement named args; change the format for this all
  toolbox["contents"].push(...Object.entries(block.fixed_predicates).filter(([k,v]) => !(block.fixed_predicates_inline[k])).map( ([key, value]) => { return {
    "kind": "block",
    "type": `fixed_pred_${value.length}`,
    "fields": {
      "VAR": key,
    },
    //"data": JSON.stringify(value)     // using this here to track types
  }; }));
  toolbox["contents"].push(...Object.entries(block.fixed_predicates).filter(([k,v]) => (block.fixed_predicates_inline[k])).map( ([key, value]) => { return {
    "kind": "block",
    "type": `fixed_pred_inline_${value.length}`,
    "fields": {
      "VAR": key,
    },
    //"data": JSON.stringify(value)     // using this here to track types
  }; }));


  if(!hidden.includes("variables")) {
    toolbox["contents"].push(...[ {"kind": "label", "text": "User Local Variables:", "web-class": "toolbox_style", } ]);
    for(let var_type of creatable_var_types) {
      toolbox["contents"] = toolbox["contents"].concat([
        {
          "kind": "button",
          "text": "Create a local variable",
          "callbackKey": "createVariableCallback_" + var_type
        },
        {
          "kind": "block",
          "type": "get_" + var_type,
        }
      ]);
    }
  }

  /*toolbox["contents"].push( ...[{
    "kind": "sep",
    "gap": "64"
  },]);*/

  let generic_map_func = (blk) => { return {
    "kind": "block",
    "type": op_internal_translate(blk)[0]
  }; };
  let generic_concat = (list) => {
    toolbox["contents"] = toolbox["contents"].concat(list.map(generic_map_func));
  };

  // each section's label only when something in it is left after @shakudo-hide
  const section = (label, list) => {
    const ops = shown(list);
    if(ops.length === 0) return;
    toolbox["contents"].push({"kind": "label", "text": label, "web-class": "toolbox_style", });
    generic_concat(ops);
  };
  section("Quantified Expressions:", quant_list);
  section("Boolean-Valued Operators", [...bin_op_list, ...un_op_list, ...compare_op_list]);
  section("Set-Valued Operators", set_bin_op_list);

  // misc... none as of this comment
  generic_concat(block_defs);

  return toolbox;
};


// ---------------------------------------------------------


/*
 * Create button callbacks and other aspects of setting up each workspace
 */
export function setupToolboxWorkspace(block: ParseBlock, workspace: Blockly.WorkspaceSvg) {
  for(let var_type of creatable_var_types) {
    workspace.registerButtonCallback("createVariableCallback_" + var_type, (button) => {
      Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace(), null, var_type);
    });
  }
};


// ---------------------------------------------------------
/*  Renderer -- type checking shapes */

var CustomRenderer = function(name) {
  CustomRenderer.superClass_.constructor.call(this, name);
};
Blockly.utils.object.inherits(CustomRenderer,
    Blockly.blockRendering.Renderer);

var CustomConstantsProvider = function() {
  CustomConstantsProvider.superClass_.constructor.call(this);
  //this.CORNER_RADIUS = 10;   //Rounded corner radius
  //this.TAB_HEIGHT = 14;  // The height of the puzzle tab used for input and output connections.
  // Add calls to create shape objects for the new connection shapes.
  this.SET_PUZZLE_TAB = this.makeSetInputConn();
};
Blockly.utils.object.inherits(CustomConstantsProvider,
    Blockly.blockRendering.ConstantProvider);

CustomConstantsProvider.prototype.makeSetInputConn = function() {
  var width = this.TAB_WIDTH * 1.1;
  var height = this.TAB_HEIGHT;
  function makeMainPathShape(up) {
    return Blockly.utils.svgPaths.line([
      Blockly.utils.svgPaths.point(-width, 0),
      Blockly.utils.svgPaths.point(width/2, -0.5 * up * height),
      Blockly.utils.svgPaths.point(-width/2, -0.5 * up * height),
      Blockly.utils.svgPaths.point(width, 0)
    ]);
  }
  var pathUp = makeMainPathShape(1);
  var pathDown = makeMainPathShape(-1);
  return {
    width: width,
    height: height,
    pathDown: pathDown,
    pathUp: pathUp
  };
};
/**  @override */
CustomConstantsProvider.prototype.shapeFor = function(
    connection) {
  var checks = connection.getCheck();
  switch (connection.type) {
    case Blockly.INPUT_VALUE:
    case Blockly.OUTPUT_VALUE:
      if(checks && checks.includes("set") ) {
        return this.SET_PUZZLE_TAB;
      }
      return this.PUZZLE_TAB;
    case Blockly.PREVIOUS_STATEMENT:
    case Blockly.NEXT_STATEMENT:
      return this.NOTCH;
    default:
      throw Error('Unknown connection type');
  }
};

CustomRenderer.prototype.makeConstants_ = function() {
  return new CustomConstantsProvider();
};

Blockly.blockRendering.register('custom_renderer', CustomRenderer);

// ---------------------------------------------------------
/*   Block definitions */

op_internal_translate = (inp_) => {
  if(typeof(inp_) == 'string') {
    return [inp_, inp_];
  } else {
    return [ inp_[0], inp_[1] ];
  }
};


gen_pred_thing = (n, block_type) => {
  let message = [...Array(n+1).keys()].map( i => `%${i+1}`).join(" ");

  let thing = {
    "type": block_type,
    "message0": message,
    "args0": [{
      "type": "field_label_serializable",
      "name": "VAR",
      "text": ""
    }],
    "colour": 280,
    "previousStatement": null,
    //"nextStatement": null
  };
  for(let i = 0; i < n; ++i) {
    thing["args0"].push({
      "type": "input_value",
      "name": "param_" + i,
      "check": ["var"]
    });
  }
  return thing;
};

// see above mention: N<=2 is strongly preferred
gen_inline_arg_pred_thing = (n, block_type) => {
  let thing = gen_pred_thing(n, block_type);
  // put the first input before the name; with no inputs there's nothing to move
  if(n > 0) { let temp = thing["args0"][1]; thing["args0"][1] = thing["args0"][0]; thing["args0"][0] = temp; }
  thing["inputsInline"] = true;
  return thing;
};

create_var_def_func = (var_type) => { return {
  "type": "get_" + var_type,
  "message0": "%1",
  "args0": [
    {    // Beginning of the field variable dropdown
      "type": "field_variable",
      "name": "VAR",    // Static name of the field
      "variable": "%{BKY_VARIABLES_DEFAULT_NAME}",    // Given at runtime
      "variableTypes": [var_type],    // Specifies what types to put in the dropdown
      "defaultType": var_type
    }
  ],
  "output": "var",    // Null means the return value can be of any type
  "colour": "#a83275",
}; };

fixed_var_def_func = (var_type, type) => {
  return {
    "type": "fixed_get_" + var_type,
    "message0": "%1",
    "args0": [{
      "type": "field_label_serializable",
      "name": "VAR",
      "text": ""
    }],
    "output": type,
    "colour": "#bd37a4",
  }; };


quant_def_func = (text) => { return {
    "type": text,
    "message0": `${text} %1 : %2 | %3`,
    "args0": [
      {
        "type": "field_variable",
        "name": "NAME",
        "variable": "item",
        "variableTypes": ["bound_var"],
        "defaultType": "bound_var"
      },
      {
        "type": "input_value",
        "name": "condition",
        "check": [ "set" ]
      },
      {
        "type": "input_statement",
        "name": "statement",
      //  "check": "Boolean",
        "align": "RIGHT"
      }
    ],
    "inputsInline": true,
    "previousStatement": null,
    //"nextStatement": null,
    "colour": "#4033a1",
    "tooltip": "",
    "helpUrl": ""
  }; };

un_op_def_func = (text) => { return {
  "type": text,
  "message0": `${text} %1`,
  "args0": [
    {
      "type": "input_statement",
      "name": "statement",
    //  "check": "Boolean",
      "align": "RIGHT"
    }
  ],
  "inputsInline": false,
  "previousStatement": null,
  //"nextStatement": null,
  "colour": 230,
  "tooltip": "",
  "helpUrl": ""
}; };

bin_op_def_func = (text) => { return {
  "type": text,
  "message0": `%1 ${text} %2`,
  "args0": [
    {
      "type": "input_statement",
      "name": "left_statement",
    //  "check": "Boolean",
      "align": "RIGHT"
    },
    {
      "type": "input_statement",
      "name": "right_statement",
    //  "check": "Boolean",
      "align": "RIGHT"
    }
  ],
  "inputsInline": false,
  "previousStatement": null,
  //"nextStatement": null,
  "colour": 230,
  "tooltip": "",
  "helpUrl": ""
}; };

compare_op_def_func = (text) => { return {
  "type": text,
  "message0": `%1 ${text} %2`,
  "args0": [
    {
      "type": "input_value",
      "name": "left_value",
      "check": "var"
    },
    {
      "type": "input_value",
      "name": "right_value",
      "check": "var"
    }
  ],
  "inputsInline": true,
  "previousStatement": null,
  //"nextStatement": null,
  "colour": 230,
  "tooltip": "",
  "helpUrl": ""
}; };


set_bin_op_def_func = (typetext, text) => { return {
  "type": typetext,
  "message0": `%1 ${text} %2`,
  "args0": [
    {
      "type": "input_value",
      "name": "left_value",
      "check": "set"
    },
    {
      "type": "input_value",
      "name": "right_value",
      "check": "set"
    }
  ],
  "output": "set",
  "inputsInline": true,
  "colour": 150,
  "tooltip": "",
  "helpUrl": ""
};};


// misc
block_defs = [

];
