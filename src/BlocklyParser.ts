/**
 * Elijah Cobb
 * elijah@elijahcobb.com
 * elijahcobb.com
 * github.com/elijahjcobb
 */



export const OParseBlockType = {
  TEXT: 0,    // uneditable text
  EDIT: 1,    // editable text generated by Blockly blocks
  HEAD: 2,    // initial header block
  NULL: 3,    // unused at the moment
  MANL: 4,    // manual: editable text, without a corresponding Blockly pane
} as const;
type ParseBlockType = typeof OParseBlockType[keyof typeof OParseBlockType];
const reverseOParseBlockType = Object.values(OParseBlockType);

export class ParseBlock {
  public type: ParseBlockType;
  public displayable: boolean;
  public editable: boolean;
  public represented: boolean;
  public title: string = "";
  public allow_multiple: boolean = false;   // for compiled nodes

  public prev: ParseBlock | null = null;
  public next: ParseBlock | null = null;

  public dirty: boolean = true;
  public dispLines: string;
  public fullLines: string;

  // note: position of blockly comments within a block are not guaranteed
  //   (but order is); they'll generally be moved to the beginning of the block
  public typeLine: string = "";   // a block-opener if present
  public blockLines: string[] = [];
  public textLines: string[] = [];

  public fixed_set_names: string[] = [];
  public fixed_predicates: string[] = [];
  public fixed_predicates_inline: boolean[] = []; // TODO do this better

  public constructor(input) {
    if(typeof input === 'number') {
      if( !(input in reverseOParseBlockType)) { let msg = "Invalid block type passed to constructor"; console.error(msg); throw msg; }
      this.type = input;  // OParseBlockType
      this.typeLine = "";
    } else if(typeof input === 'string') {
      let extractType = BlocklyParse.extractShakudoComment(input);
      if(extractType === null) { let msg = "block constructor received a string that wasn't a shakudo comment"; console.error(msg); throw msg; }
      if( !(extractType in BlocklyParse.shakudo_comments_blockers)) { let msg = "block constructor received a typeLine that doesn't give a block type"; console.error(msg); throw msg; }
      this.typeLine = input;
      this.type = BlocklyParse.shakudo_comments_blockers[extractType];

      let tit_res = input.split(extractType).map(e => e.trim()).filter(e => e);
      if(tit_res.length > 1)  this.title = tit_res[1];

    } else { let msg = "Block constructor received a wrong-typed parameter"; console.error(msg); throw msg; }

    this.displayable = [ OParseBlockType.TEXT, OParseBlockType.EDIT, OParseBlockType.MANL ].includes(this.type);
    this.editable = [ OParseBlockType.EDIT, OParseBlockType.MANL ].includes(this.type);
    this.represented = [ OParseBlockType.EDIT ].includes(this.type);
  }

  // check that all the block lines are valid for this block type
  // basically just tests for now,
  //     *  but later will be "evaluate the shakudo comments"   * if relevant
  public parse() {
    for(const line of this.blockLines) {
      //put whatever tests you like here
      let shak_line = BlocklyParse.extractShakudoComment(line);
      console.assert(shak_line !== null, "Invalid parse: corrupted block lines");
      console.assert(BlocklyParse.shakudo_comments.indexOf(shak_line) > -1, "Invalid parse: not a shakudo comment");
      console.assert(! (shak_line in BlocklyParse.shakudo_comments_blockers), "Invalid parse: block starter in block lines");
    }

    for(const line of this.blockLines) {
      let shak_line = BlocklyParse.extractShakudoComment(line);
      if(shak_line === "define_sig") {
        let var_names = line.split("define_sig ")[1].split(" ").map(l=>l.trim()).filter(e=>e.toString());
        for(const vn of var_names){
          this.fixed_set_names.push(vn);
        }
      } else if(shak_line === "define_pred" || shak_line === "define_pred_inline") {
        let splitter = line.split(shak_line + " ")[1].split(" ").map(l=>l.trim()).filter(e=>e.toString());
        this.fixed_predicates[ splitter[0] ] = splitter.slice(1);
        this.fixed_predicates_inline[ splitter[0] ] = (shak_line === "define_pred_inline");
      } else if(shak_line === "allow_multiple") {
        this.allow_multiple = true;
      }
    }

    // TODO: Actually take this out, there could be eg inheritance and stuff making this ugly
    // eslint-disable-next-line
    for(const [pred, types] of this.fixed_predicates.entries()) {
      for(const typo of types) {
        console.assert(this.fixed_set_names.contains(typo), "Predicate requires types that aren't declared in this block");
      }
    }
  }

  // update dispLines if it's dirty
  public updateText() {
    if(this.dirty) {
      this.dispLines = this.textLines;
      this.fullLines = [ this.typeLine ].concat(this.blockLines, this.dispLines);
      if(this.typeLine === "") this.fullLines.shift();
      this.dirty = false;
    }
  }

}

/**
 * This class represents a particular parsing of the code.
 *  It's basically just a linked list of ParseBlocks above
 */
export class BlocklyParse {


  public firstBlock: ParseBlock;
  public dispLines: string[] = [];
  public fullLines: string[] = [];

  public locations: {s: number, l: number, b: ParseBlock | null }[] = [];
  public dispBlocks: ParseBlock[] = [];

  /**
   *  Generate a Parse object by calling the static parse() method
   *  @private
   */
	private constructor(firstBlock: ParseBlock) {
    this.firstBlock = firstBlock;
    // TODO: add a way so I can just iterate by, like "for blocks in _"
  }

	/**
	 * Parse the source and return an array of start and end objects determining where blocks should be.
	 * @param value The source code.
	 */
	public static parse(value: string): BlocklyParse {
    const lines: string[] = value.split("\n");

    let firstBlock = new ParseBlock(OParseBlockType.HEAD);
    let currBlock = undefined;

    // implicit 'text' block to start if there isn't an explicit first block
    let shak_line = BlocklyParse.extractShakudoComment(lines[0]);
    if( shak_line === null || !(shak_line in BlocklyParse.shakudo_comments_blockers)) {
      currBlock = new ParseBlock(OParseBlockType.TEXT);
      firstBlock.next = currBlock;
      currBlock.prev = firstBlock;
    } else {
      currBlock = firstBlock;
    }

		for (const line of lines) {
      shak_line = BlocklyParse.extractShakudoComment(line);
      if(shak_line === null) {
        currBlock.textLines.push(line);
      } else if( !(shak_line in BlocklyParse.shakudo_comments_blockers)) {
        currBlock.blockLines.push(line);
      } else {
        currBlock.parse();
        let newBlock = new ParseBlock(line);
        currBlock.next = newBlock;
        newBlock.prev = currBlock;
        currBlock = newBlock;
      }
		}
    currBlock.parse();

		let outputParse = new BlocklyParse(firstBlock);

    // creates the initial outputLines and locations;
    //   thereafter it's better to let CodeMirror handle those details,
    //   and update the blocks when necessary.
    outputParse.updateTextLines();
    outputParse.updateInitLocations();

    return outputParse;
	};

  public updateTextLines() {
    this.dispLines = [];
    this.fullLines = [];
    for(let curr: ParseBlock | null = this.firstBlock; curr !== null; curr = curr.next) {
      curr.updateText();
      this.fullLines = this.fullLines.concat(curr.fullLines);
      if(curr.displayable) {
        this.dispLines = this.dispLines.concat(curr.dispLines);
      }
    }
  };

  public updateInitLocations() {
    this.locations = [ {s: 0, l: 0, b: null} ];
    for(let curr: ParseBlock | null = this.firstBlock; curr !== null; curr = curr.next) {
      curr.updateText();
      if(curr.displayable ) {
        let prevLoc = this.locations[this.locations.length - 1];
        this.locations.push(
          { s: prevLoc.s + prevLoc.l, l: curr.textLines.length, b: curr }   );
      }
    }
    this.locations.shift();
  };


  /**
   * eg "   // @shakudo-edit" --> "edit"; text lines --> null
   * should then check if the returned text is actually in blockly_comments
   */
  public static extractShakudoComment(line: string): string | null {
    line = line.trim();
    if(line.startsWith("//") || line.startsWith("--")) {
      line = line.substring(2).trim();
      if(line.startsWith("@shakudo-")) {
        line = line.substring(9).split(/\s+/, 1)[0].toLowerCase().trim();
        return line;
      }
    }
    return null;
  };

  static shakudo_comments = [ "edit", "text", "manual", "comment", "define_sig", "define_pred", "define_pred_inline", "allow_multiple" ];
  static shakudo_comments_blockers = {  // as in "starts a block"
    "edit": OParseBlockType.EDIT,
    "text": OParseBlockType.TEXT,
    "manual": OParseBlockType.MANL
  };

};
