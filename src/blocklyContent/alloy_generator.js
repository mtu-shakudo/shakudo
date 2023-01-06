import Blockly from "blockly"
import {ParseBlock} from "./BlocklyParser"

import "./custom_dropdown.js"
import "./custom_renderer.js"


/*
  -- "Table of Contents": --

This file defines the generator:
      export const Alloy = new Blockly.Generator('Alloy')
Then, the following three functions must be called at the point of use,
  to make the toolbox; populate after parsing the ParseBlock; and finish the Workspace
      export function setupBlocks(): Blockly.Toolbox
      export function setupToolboxContents(block: ParseBlock)
      export function setupToolboxWorkspace(block: ParseBlock, workspace: Blockly.WorkspaceSvg)
*/

// block definitions -- defined at the bottom of this file
var block_defs;
var gen_pred_thing, gen_inline_arg_pred_thing;
var fixed_var_def_func, create_var_def_func, quant_def_func, un_op_def_func, bin_op_def_func, compare_op_def_func, set_bin_op_def_func;

// function implementations in setupBlocks
export var quant_list  = ["all", "some", "one", "lone", "no"];  // BLK NAME: quant_blk
export var un_op_list  = ["not"]; // BLK NAME: bool_un_op_blk
export var bin_op_list = ["and", "or", "implies", "iff"]; // BLK NAME: bool_bin_op_blk
export var compare_op_list = ["=", "!="];  // BLK NAME: var_bin_op_blk,  // todo: human-friendly words (dict?)
export var set_bin_op_list = [ ["+", "union"], ["&", "intersect"], "-" ] // BLK NAME: set_bin_op_blk

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
export var binding_blocks =  ["quant_blk"];   // quant_list;
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
    var value = Alloy.nameDB_.getName(block.getFieldValue('VAR'), 'VARIABLE');  // assuming bars, not procedures, eh*/
    var code = value;
    //stupid_debug("get_func: ", block, code);
    return [code, 0];   // precedence goes here, later
  }
  let fixed_get_func = (blk) => [ blk.getFieldValue('VAR'), 0];

  // ... bound_var
  for(let var_type of creatable_var_types) {
    upd_block_defs.push( create_var_def_func(var_type) );
    Alloy['get_' + var_type] = get_func;
  }
  // ... predef_var (not actually used!)
  for(let var_type of fixed_var_types) {
    upd_block_defs.push( fixed_var_def_func(var_type, "var") );
    Alloy['fixed_get_' + var_type] = fixed_get_func;
  }
  // ... predef_set
  for(let var_type of fixed_set_types) {
    upd_block_defs.push( fixed_var_def_func(var_type, "set") );
    Alloy['fixed_get_' + var_type] = fixed_get_func;
  }

  // add the block for fixed predicates
      // there's one type for each 'size' (# args); there may be a a better way
      // update: there is a better way, see the generators in blockly package
      //  changing to that format is low priority since this works fine for now
  var MAX_PREDICATE_SIZE = 10;  // again, there should be a better way than this...

  function pred_resp_function(n) {
    return function(block) {
      let code = Alloy.nameDB_.getName(block.getFieldValue('VAR'), 'VARIABLE') + "[";
      //stupid_debug("pred: ", block, code);

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
  Alloy["quant_blk"] = function(block) {
    //stupid_debug("quant_func: ", block, "<undet yet>" );
    var substatements = Alloy.statementToCode(block, 'statement');
    var source_set = Alloy.valueToCode(block, 'condition', 0) || " ";
    var variable = Alloy.nameDB_.getName(block.getFieldValue('VAR'), 'VARIABLE');
    var quant_type = block.getFieldValue('quant_type_dropdown');

    var code = quant_type + ' ' + variable + ': ' + source_set + ' {\n'
    + substatements;
    if(substatements[substatements.length - 1] !== "\n") code += "\n";
    code += "}";
    return code ;//+ "\n";
  };
  upd_block_defs.push(quant_def_func(""));  //inp_str


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
  var wrap_value = (block, statement) => _wrapper(block, statement, (b,s) => Alloy.valueToCode(b, s, 0) || " " );


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
  function bin_op_func() {
    Alloy["bool_bin_op_blk"] = function(block) {
      var op_type = block.getFieldValue('slct_type_dropdown');
      var left = wrap_state(block, 'left_statement');
      var right = wrap_state(block, 'right_statement');
      var code = left + ' ' + op_type + ' ' + right;
      return code;
    };
    upd_block_defs.push(bin_op_def_func());
  }
  bin_op_func();  //bin_op_list.forEach( bin_op_func );

  function compare_op_func() {
    Alloy["var_bin_op_blk"] = function(block) {
      var op_type = block.getFieldValue('slct_type_dropdown');
      var left  = wrap_value(block, 'left_value');
      var right = wrap_value(block, 'right_value');
      var code = left + ' ' + op_type + ' ' + right;
      return code;
    };
    upd_block_defs.push(compare_op_def_func());
  }
  compare_op_func();  //compare_op_list.forEach( compare_op_func );

  function set_bin_op_func() {
    Alloy["set_bin_op_blk"] = function(block) {
      var op_type = block.getFieldValue('slct_type_dropdown');
      //const [inp_str, inp_label] = op_internal_translate(inp_);
      var left  = wrap_value(block, 'left_value');
      var right = wrap_value(block, 'right_value');
      var code = left + ' ' + op_type + ' ' + right;
      return [code, 0];
    };
    upd_block_defs.push(set_bin_op_def_func());
  }
  set_bin_op_func(); //set_bin_op_list.forEach( set_bin_op_func );

	Blockly.defineBlocksWithJsonArray(upd_block_defs);
};






// ---------------------------------------------------------

/*
 * Defines the presence and appearance of the blocks in each toolbox
 */
export function setupToolboxContents(block: ParseBlock) {

  // various utility functions, and setup
  var toolbox = {
    "kind": "flyoutToolbox",
    "contents": [],
  };

  let generic_map_func = (blk) => { return {
    "kind": "block",
    "type": op_internal_translate(blk)[0]
  }; };
  let small_sep = { "kind": "sep", "gap": "8" };  // for man
  let large_sep = { "kind": "sep", "gap": "32" }; // for mankind
  let raw_push = (item) => { toolbox["contents"].push(item); };
  let sep_insert = (item, sep) => { raw_push(item); raw_push(sep); };

  let short_push = (item) => { sep_insert(item, small_sep); };
  let generic_short_push = (item) => { short_push(generic_map_func(item)); };
  let inter_concat = (list) => { list.flatMap(x => [x, small_sep]).slice(0, -1).forEach(raw_push); };
  let short_end = () => { raw_push(small_sep); };
  let large_end = () => { raw_push(large_sep); };

  // instructor-created sigs, preds, etc
  short_push({"kind": "label", "text": "Available Signatures:", "web-class": "toolbox_style", });
  inter_concat(block.fixed_set_names.map( vname => { return {
    "kind": "block",
    "type": "fixed_get_predef_set",
    "fields": {
      "VAR": vname,
    },
  }; }) );
  large_end();

  short_push({"kind": "label", "text": "Available Predicates:", "web-class": "toolbox_style", });
  // TODO: Enforce types; implement named args; change the format for this all
  inter_concat(Object.entries(block.fixed_predicates).filter(([k,v]) => !(block.fixed_predicates_inline[k])).map( ([key, value]) => { return {
    "kind": "block",
    "type": `fixed_pred_${value.length}`,
    "fields": {
      "VAR": key,
    },
    //"data": JSON.stringify(value)     // using this here to track types
  }; }));
  short_end();
  inter_concat(Object.entries(block.fixed_predicates).filter(([k,v]) => (block.fixed_predicates_inline[k])).map( ([key, value]) => { return {
    "kind": "block",
    "type": `fixed_pred_inline_${value.length}`,
    "fields": {
      "VAR": key,
    },
    //"data": JSON.stringify(value)     // using this here to track types
  }; }));
  large_end();

  // brief interlude to add tooltips to predicates, don't mind me
  let fix_thing = function(block_type) {
    let former_init = Blockly.Blocks[block_type].init;
    Blockly.Blocks[block_type].init = function() {
      var thisBlk = this;
      former_init.bind(thisBlk)();
      this.setTooltip(function() {
        let key = thisBlk.getFieldValue("VAR");
        let res = block.fixed_predicates_descs[key] + "\n-- Input types: --";
        let i = 1;
        for(const type of block.fixed_predicates[key]) {
          res += `\nInput ${i} :  ${type}`;
          i += 1;
        }
        return res.trim();
      });
    };//*/
  };
  for(let n = 0; n <= 2; ++n) {
    let block_type = `fixed_pred_inline_${n}`;
    fix_thing(block_type);
  }
  for(let n = 0; n <= 10; ++n) {
    let block_type = `fixed_pred_${n}`;
    fix_thing(block_type);
  }

  // okay, back to block defs: operators
  short_push({"kind": "label", "text": "User Local Variables:", "web-class": "toolbox_style", });
  // for(let var_type of creatable_var_types) { // look, there's only bound_var, okay?
  inter_concat([
    {
      "kind": "block",
      "type": "get_" +  "bound_var"   //var_type,
    },
    {
      "kind": "button",
      "text": "Clear Unused Variable Names",
      "callbackKey": "clearExtraVariableCallback"
    },
  ]);
  large_end();

  short_push({"kind": "label", "text": "Quantified Expressions:", "web-class": "toolbox_style" });
  generic_short_push("quant_blk");  //generic_concat(quant_list);
  large_end();

  short_push({"kind": "label", "text": "Boolean-Valued Operators:", "web-class": "toolbox_style", });
  un_op_list.forEach(generic_short_push);
  generic_short_push("bool_bin_op_blk");
  generic_short_push("var_bin_op_blk");
  large_end();

  short_push({"kind": "label", "text": "Set-Valued Operators:", "web-class": "toolbox_style", });
  generic_short_push("set_bin_op_blk");
  large_end();

  // misc... none as of this comment
  inter_concat(block_defs.map(generic_map_func));
  // spacer at the end doesn't seem to actually add space, so empty label:
  short_push({"kind": "label", "text": '\u200B', "web-class": "toolbox_style", });

  return toolbox;
};


// ---------------------------------------------------------


/*
 * Create button callbacks and other aspects of setting up each workspace
 */
export function setupToolboxWorkspace(block: ParseBlock, workspace: Blockly.WorkspaceSvg) {
  workspace.extra_reserved_ = block.fixed_set_names.concat(Object.keys(block.fixed_predicates)).map(v => v.toLowerCase());
  workspace.registerButtonCallback("clearExtraVariableCallback", (button) => {
    let wrk = button.getTargetWorkspace();
    let all_vars = wrk.getAllVariables();
    let used_vars = Blockly.Variables.allUsedVarModels(wrk);
    all_vars.filter(e => !used_vars.includes(e) ).forEach(e => {
      wrk.deleteVariableById(e.getId());
    });
    if(wrk.getAllVariables().length == 0) {
      wrk.createVariable("default", "bound_var");
    }
  });
};


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
  let temp = thing["args0"][1]; thing["args0"][1] = thing["args0"][0]; thing["args0"][0] = temp;
  thing["inputsInline"] = true;
  return thing;
};



create_var_def_func = (var_type) => { return {
  "type": "get_" + var_type,
  "message0": "%1",
  "args0": [
    {    // Beginning of the field variable dropdown
      "type": "input_dummy",
      "name": "DUMMY_INPUT",    // Static name of the field
      "variableTypes": [var_type],    // Specifies what types to put in the dropdown
      "defaultType": var_type
    }
  ],
  "output": "var",    // Null means the return value can be of any type
  "colour": "#a83275",
  "extensions": ["gen_menu_ext"]
}; };//*/



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
    "type": "quant_blk",
    "message0": `%4 %1 : %2 | %3`,
    "args0": [
      {
        "type": "input_dummy",
        "name": "DUMMY_INPUT",
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
      },
      {
        "type": "field_dropdown",
        "name": "quant_type_dropdown",
        "options": quant_list.map(x => op_internal_translate(x))
      },
    ],
    "inputsInline": true,
    "previousStatement": null,
    //"nextStatement": null,
    "colour": "#4033a1",
    "tooltip": "",
    "helpUrl": "",
    "extensions": ["gen_menu_ext"]  // menu to select variable
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

bin_op_def_func = () => { return {
  "type": "bool_bin_op_blk",
  "message0": `%3 %1 %2`,
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
    },
    {
      "type": "field_dropdown",
      "name": "slct_type_dropdown",
      "options": bin_op_list.map(x => op_internal_translate(x))
    },
  ],
  "inputsInline": false,
  "previousStatement": null,
  //"nextStatement": null,
  "colour": 230,
  "tooltip": "",
  "helpUrl": ""
}; };

compare_op_def_func = () => { return {
  "type": "var_bin_op_blk",
  "message0": `%1 %3 %2`,
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
    },
    {
      "type": "field_dropdown",
      "name": "slct_type_dropdown",
      "options": compare_op_list.map(x => op_internal_translate(x))
    },
  ],
  "inputsInline": true,
  "previousStatement": null,
  //"nextStatement": null,
  "colour": 230,
  "tooltip": "",
  "helpUrl": ""
}; };


set_bin_op_def_func = () => { return {
  "type": "set_bin_op_blk",
  "message0": `%1 %3 %2`,
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
    },
    {
      "type": "field_dropdown",
      "name": "slct_type_dropdown",
      "options": set_bin_op_list.map(x => { const xx = op_internal_translate(x); return [xx[1], xx[0]];})
    },
  ],
  "output": "set",
  "inputsInline": true,
  "colour": 150,
  "tooltip": "",
  "helpUrl": ""
};};

/*
base_block = (text) => { return {
  "message0": `${text} | %1`,
  "args0": [ {
    "type": "input_statement",
    "name": "statement",
    "align": "RIGHT"
  } ],
  "nextStatement": null,
  "colour": "#808080"
};};
*/


// misc
block_defs = [

];


/*function stupid_debug(typ, block, code) {
  console.log( typ + "  " + code);
  console.log(block);
  console.log(block.type);
  console.log(Alloy.nameDB_.getUserNames('VARIABLE'));
  console.log(block.getField('VAR').referencesVariables());
  console.log("----------");
}//*/
