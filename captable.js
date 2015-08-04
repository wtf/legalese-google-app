/**
testing to see if commit works
 * An object representing a captable.
 * it gets used by the AA-SG-SPA.xml:
 *
 * <numbered_2_firstbold>Capitalization</numbered_2_firstbold>
 *
 * in future it will be something like data.capTable.getCurrentRound().by_security_type(...)
 * and it will know what the currentRound is from the name of the ...getActiveSheet()
 *
 * <numbered_3_para>Immediately prior to the Initial Closing, the fully diluted capital of the Company will consist of <?= digitCommas_(data.capTable.getRound("Bridge Round").by_security_type["Ordinary Shares"].TOTAL) ?> ordinary shares, <?= digitCommas_(data.capTable.getRound("Bridge Round").by_security_type["Class F Shares"].TOTAL) ?> Class F Redeemable Convertible Preference Shares both issued and reserved, and <?= digitCommas_(data.capTable.getRound("Bridge Round").by_security_type["Series AA Shares"].TOTAL) ?> YC-AA Preferred Shares. These shares shall have the rights, preferences, privileges and restrictions set forth in <xref to="articles_of_association" />.</numbered_3_para>
 * <numbered_3_para>The outstanding shares have been duly authorized and validly issued in compliance with applicable laws, and are fully paid and nonassessable.</numbered_3_para>
 * <numbered_3_para>The Company's ESOP consists of a total of <?= data.parties.esop[0].num_shares ?> shares, of which <?= digitCommas_(data.parties.esop[0]._orig_num_shares - data.capTable.getRound("Bridge Round").old_investors["ESOP"].shares) ?> have been issued and <?= digitCommas_(data.capTable.getRound("Bridge Round").old_investors["ESOP"].shares)?> remain reserved.</numbered_3_para>
 *
 * the above hardcodes the name of the round into the XML. this is clearly undesirable.
 * we need a better way to relate the active round with the relevant terms spreadsheet.
 *
 * How does this work?
 * First we go off and parse the cap table into a data structure
 * then we set up a bunch of methods which interpret the data structure as needed for the occasion.
 *
 * Maybe in future the argument to the constructor should be a readRows_ object, not a sheet.
 *
 * @constructor
 * @param {Sheet} termsheet - the currently active sheet which we're filling templates for
 * @param {Sheet} [captablesheet=sheet named "Cap Table"] - the sheet containing a well-formed cap table
 * @return {capTable}
 */
var DEFAULT_TERM_TEMPLATE = "https://docs.google.com/spreadsheets/d/1rBuKOWSqRE7QgKgF6uVWR9www4LoLho4UjOCHPQplhw/edit#gid=1632229599";
var DEFAULT_CAPTABLE_TEMPLATE = "https://docs.google.com/spreadsheets/d/1rBuKOWSqRE7QgKgF6uVWR9www4LoLho4UjOCHPQplhw/edit#gid=827871932";


function capTable_(termsheet, captablesheet) {
  termsheet     = termsheet     || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  captablesheet = captablesheet || termsheet.getParent().getSheetByName("Cap Table");

  if (captablesheet == undefined) {
	Logger.log("capTable: there is no Cap Table sheet!");
	this.isValid = false;
	return;
  }
  this.isValid = true;
  
  Logger.log("capTable_: parsing captablesheet %s, active round being %s",
			 captablesheet.getSheetName(), termsheet.getSheetName());

  /**
	* @member {string}
	*/
  this.activeRound = termsheet.getSheetName();

  /**
	* @member
	*/
  this.rounds = parseCaptable(captablesheet);

  /**
	* @method
	* @param {string} roundName - the name of the round you're interested in
	* @return {object} round - a round
	*/
  this.getRound = function(roundName) {
	var toreturn;
	for (var ri = 0; ri < this.rounds.length; ri++) {
	  if (this.rounds[ri].name == roundName) {
		toreturn = this.rounds[ri];
		break;
	  }
	}
	return toreturn;
  };

  /**
	* @method
	* @return {object} round - the round corresponding to the active spreadsheet
	*/
  this.getActiveRound = function() {
	return this.getRound(this.activeRound);
  };
  
  if (! this.getActiveRound()) {
	// throw "cap table has no column named " + termsheet.getSheetName();
  }
  
  /**
	* @method
	* @return {Array<string>} column names - all the major columns in the cap table
	*/
  this.columnNames = function() {
	for (var cn = 0; cn < this.rounds.length; cn++) {
	  Logger.log("capTable.columnNames: column %s is named %s", cn, this.rounds[cn].name);
	}
  };

  
  // for each major column we compute the pre/post, old/new investor values.
  // we want to know:
  // - who the existing shareholders are before the round:
  //   old_investors: { investorName: { shares, money, percentage } }
  // - how many total shares exist at the start of the round:
  //   shares_pre
  // - how many shares of different types exist at the start of the round:
  //   by_security_type = { "Class F Shares" : { "Investor Name" : nnn, "TOTAL" : mmm }, ... }
  //
  // - we keep a running total to carry forward from round to round
  var totals = { shares_pre: 0,
				 money_pre: 0,
				 all_investors: {},
				 by_security_type: {},
			   };

  for (var cn = 0; cn < this.rounds.length; cn++) {
	var round = this.rounds[cn];
	Logger.log("capTable.new(): embroidering column %s", round.name);

	// if only we had some sort of native deepcopy method... oh well.
	round.old_investors = {};
	for (var ai in totals.all_investors) {
	  round.old_investors[ai] = {};

	  // handle the _orig_ first, then formatify to produce the actual attribute
	  for (var attr in totals.all_investors[ai]) {
		if (! attr.match(/^_orig_/)) continue;
		round.old_investors[ai][attr] = totals.all_investors[ai][attr];
	  }
	  for (var attr in totals.all_investors[ai]) {
		if (attr.match(/^_orig_/)) continue;
		round.old_investors[ai][attr] = formatify_(totals.all_investors[ai]["_format_" + attr], totals.all_investors[ai]["_orig_" + attr], termsheet, attr);
	  }
	}
	Logger.log("capTable.new(): %s.old_investors = %s", round.name, round.old_investors);

	totals.by_security_type[round.security_type] = totals.by_security_type[round.security_type] || {};

	round.shares_pre = totals.shares_pre;

	var new_shares = 0, new_money = 0;
	for (var ni in round.new_investors) {
	  if (round.new_investors[ni].shares == undefined) continue;
	  // handle the _orig_ first, then formatify to produce the actual attribute
	  new_shares += round.new_investors[ni]._orig_shares;
	  new_money  += round.new_investors[ni]._orig_money;
	  totals.by_security_type[round.security_type][ni] = totals.by_security_type[round.security_type][ni] || 0; // js lacks autovivication, sigh
	  totals.by_security_type[round.security_type][ni] += round.new_investors[ni]._orig_shares;
	  for (var attr in round.new_investors[ni]) {
		if (round.new_investors[ni] == undefined) { continue } // sometimes an old investor doesn't re-up, so they're excused from action.
		if (attr == "percentage") { continue } // percentages don't need to add
		if (round.new_investors[ni][attr] == undefined) { continue } // money and shares do, but we don't always get new ones of those.
		totals.all_investors[ni] = totals.all_investors[ni] || {};
		totals.all_investors[ni][attr] = totals.all_investors[ni][attr] || 0;
		if (attr.match(/^_orig_/)) {
		  totals.all_investors[ni][attr] += round.new_investors[ni][attr];
		} else {
		  totals.all_investors[ni][attr] = round.new_investors[ni][attr];
		}
	  }
	}

	round.by_security_type = {};
	for (var bst in totals.by_security_type) {
	  round.by_security_type[bst] = { TOTAL: 0};
	  for (var inv in totals.by_security_type[bst]) {
		round.by_security_type[bst][inv]   = totals.by_security_type[bst][inv];
		round.by_security_type[bst].TOTAL += totals.by_security_type[bst][inv];
	  }
	}
	Logger.log("capTable: round.by_security_type = %s", JSON.stringify(round.by_security_type));

	if (round.new_investors["ESOP"] != undefined && round.new_investors["ESOP"].shares) {
	  Logger.log("capTable: round %s has a new_investor ESOP with value %s", round.name, round.new_investors["ESOP"]);
	  round.ESOP = round.ESOP || new ESOP_(round.security_type, 0);
	  Logger.log("capTable: establishing ESOP object for round %s", round.name);
	  var seen_ESOP_investor = false;
	  for (var oi in round.ordered_investors) {
		var inv = round.ordered_investors[oi];
		Logger.log("capTable: considering investor %s", inv);
		if (inv == "ESOP") { seen_ESOP_investor = true;
							 round.ESOP.createHolder(inv);
							 round.ESOP.holderGains(inv, round.new_investors[inv]._orig_shares);
							 continue;
						   }
		else if ( seen_ESOP_investor ) {
		  round.ESOP.createHolder(inv);
		  round.ESOP.holderGains(inv, round.new_investors[inv].shares);
		}
		else {
		  Logger.log("capTable: in constructing the ESOP object for round %s we ignore any rows above the ESOP line -- %s", round.name, inv);
		}
		// TODO: in future add a running total, similar to the rest of how we manage shares by type above.
		// if we don't do this, then multiple columns which deal with ESOP will not do the right thing.
	  }
	  Logger.log("capTable: created an ESOP object for round %s: %s", round.name, JSON.stringify(round.ESOP.holders));
	}


//	Logger.log("capTable.new(): we calculate that round \"%s\" has %s new shares", round.name, new_shares);
//	Logger.log("capTable.new(): the sheet says that we should have %s new shares", round.amount_raised.shares);
	// TODO: we should probably raise a stink if those values are not the same.
//	Logger.log("capTable.new(): we calculate that round \"%s\" has %s new money", round.name, new_money);
//	Logger.log("capTable.new(): the sheet says that we should have %s new money", round.amount_raised.money);
  }

//  Logger.log("capTable.new(): embroidered rounds to %s", this.rounds);

  /**
	* @method
	* @return {object} round - the round corresponding to the active spreadsheet
	*/
  this.getActiveRound = function() {
	return this.getRound(this.activeRound);
  };

  /**
	* @method
	* @param {string} roundName - the name of the round you're interested in
	* @return {object} round - a round
	*/
  this.getRound = function(roundName) {
	var toreturn;
	for (var ri = 0; ri < this.rounds.length; ri++) {
	  if (this.rounds[ri].name == roundName) {
		toreturn = this.rounds[ri];
		break;
	  }
	}
	return toreturn;
  };

  /**
	* @member {object}
	*/
  this.byInvestorName = {}; // investorName to Investor object

  // what does an Investor object look like?
  // { name: someName,
  //   rounds: [ { name: roundName,
  //               price_per_share: whatever,
  //               shares: whatever,
  //               money: whatever,
  //               percentage: whatever,
  //             }, ...
  //           ]

  /** all the investors
	* @method
	* @return {Array<object>} investors - ordered list of investor objects
	*/
  this.allInvestors = function() {
	var toreturn = [];

	// walk through each round and add the investor to toreturn
	for (var cn = 0; cn < this.rounds.length; cn++) {
	  var round = this.rounds[cn];
	  if (round.name == "TOTAL") { continue; }
	  var new_investors = round.new_investors;

	  for (var investorName in new_investors) {
		var investorInRound = new_investors[investorName];
		var investor;
		if (this.byInvestorName[investorName] == undefined) {
		  investor = this.byInvestorName[investorName] = { name: investorName };
		  toreturn.push(investor);
		} else {
		  investor = this.byInvestorName[investorName];
		}

		if (investor.rounds == undefined) {
		  investor.rounds = [];
		}
		investor.rounds.push({name:            round.name,
							  price_per_share: round.price_per_share.shares,
							  shares:          investorInRound.shares,
							  money:           investorInRound.money,
							  percentage:      investorInRound.percentage,
							 });
	  }
	}
	Logger.log("i have built allInvestors: %s", JSON.stringify(toreturn));
	return toreturn;
  };

    /*this.updateRounds() = function(round){
	
    };

    this.getRoundbyName() = function(name){
    };

    this.getRoundbyNumber() = function(num){
    };

    this.getPre() = function(){
    }

    this.updateInvestorPercentage() = function(round){
    }

    this.getPost() = function(round){
    }
*/
    
  /**
	* @method
	* @return {String} holdings - "3 Ordinary Shares and 200 Class F Shares"
	*/
  this.investorHoldingsInRound = function(investorName) {
	var round = this.getActiveRound();
	var pre = [];
	for (var bst in round.by_security_type) {
	  if (round.by_security_type[bst][investorName]) { pre.push([round.by_security_type[bst][investorName], bst.replace(/(share)(s)/i,function(match,p1,p2){return p1})]) }
	}
	return commaAnd(pre.map(function(bst_count){return digitCommas_(bst_count[0]) + "&#8232;" + plural(bst_count[0], bst_count[1])}));
  };

  
  /** return new roles for imputation by readRows_.handleNewRoles()
	* @method
	*/
  this.newRoles = function() {
	var round = this.getActiveRound();
	// all the old investors are given "shareholder" roles
	// all the new investors are given "new_investor" roles.

	var toreturn = [];
	if (! round) { return toreturn }

	for (var ni in round.new_investors) {
	  if (ni == "ESOP" || // special case
		  round.new_investors[ni].money  == undefined &&
		  round.new_investors[ni].shares == undefined
		 ) continue;
	  var newRole = { relation:"new_investor", entityname:ni };
	  newRole.attrs = { new_commitment:       round.new_investors[ni].money,             num_new_shares: round.new_investors[ni].shares,
				        _orig_new_commitment: round.new_investors[ni]._orig_money,  orig_num_new_shares: round.new_investors[ni]._orig_shares };
	  toreturn.push(newRole);
	}

	for (var oi in round.old_investors) {
	  if (oi == "ESOP" || // special case
		  round.old_investors[oi].money  == undefined &&
		  round.old_investors[oi].shares == undefined
		 ) continue;
	  var newRole = { relation:"shareholder", entityname:oi, attrs:{} };
	  toreturn.push(newRole);
	}

	Logger.log("capTable.newRoles(): imputing %s roles", toreturn.length);
	return toreturn;
  };
  
}

// parseCaptable
// previously known as "Show Me The Money!"

// returns an array (all the rounds) of hashes (each round) with hashes (each investor).
// ECMAscript 6 specifies that hashes maintain key ordering, so i did that at first,
// but some random guy on the Internet said that hashes are unordered, so I used an array lor.
// [
//  {
//    security_type: string,
//    approximate_date: Date,
//    pre_money: NNN,
//    price_per_share: P,
//    discount: D,
//    new_investors:
//      { investorName: {
//           shares: N,
//           money:  D,
//           percentage: P,
//        },
//        investorName: {
//           shares: N,
//           money:  D,
//           percentage: P,
//        },
//      },
//    amount_raised: NNN,
//    shares_post: NNN,
//    post_money: NNN,
//  },
//  ... // another round
//  ... // another round
//  { name: "TOTAL", ... }
// ]
function parseCaptable(sheet) {
  if (sheet == undefined) { throw "parseCaptable() called without a Cap Table sheet specified!" }
  Logger.log("parseCaptable: running on sheet %s", sheet.getSheetName());

  var captableRounds = [];
  var rows = sheet.getDataRange();
  var numRows  = rows.getNumRows();
  var values   = rows.getValues();
  var formulas = rows.getFormulas();
  var formats  = rows.getNumberFormats();

  var section = null;
  var majorToRound = {};
  var majorByName = {}; // round_name: column_index
  var majorByNum  = {}; // column_index: round_name
  var minorByName = {}; // money / shares / percentage is in column N
  var minorByNum  = {}; // column N is a money column, or whatever

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];

    if (row[0] == "CAP TABLE") { section = row[0]; continue }

    if (section == "CAP TABLE") {
      // INITIALIZE A NEW ROUND
	  // each major column is on a 3-column repeat.
	  var asvar0 = asvar_(row[0]);
	  // asvar_("my Cool String (draft)") is "my_cool_string_draft".
	  // other people might do myCoolStringDraft, but I don't like camelCase.
      if (row[0] == "round name") {
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/roundname: looking at row[%s], which is %s",
//                                                          j,        row[j]);
          majorByName[row[j]] =     j;
          majorByNum     [j]  = row[j];
		  majorToRound[row[j]]= captableRounds.length;

          captableRounds.push( { name: row[j], new_investors: {}, ordered_investors: [] } ); // we haz a new round!
//          Logger.log("captable/roundname: I have learned about a new round, called %s", row[j]);
        }
      }
	  // ABSORB THE MAJOR-COLUMN ROUND ATTRIBUTES
      else if (row[0] == "security type" ||
			   row[0] == "approximate date"
      ) {
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/securitytype: looking at row[%s], which is %s",
//                                                             j,        row[j]);
          // if i'm in column j, what round am i in?
          var myRound = captableRounds[majorToRound[majorByNum[j]]];
          myRound[asvar_(row[0])] = row[j];
        }
      }
	  // LEARN ABOUT THE MINOR COLUMN ATTRIBUTES
      else if (row[0] == "break it down for me") {
        // each minor column has its own thang, so that later we will have
        // myRound.pre_money.money = x, myRound.pre_money.shares = y, myRound.pre_money.percentage = z
        // myRound[investorName].money = x, myRound[investorName].shares = y, myRound[investorName].percentage = z
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/breakdown: looking at row[%s], which is %s",
//                                                          j,        row[j]);
          var myRound; // we might be offset from a major column boundary so keep looking left until we find a major column.

          for (var k = 0; k < j; k++) {
            if (! captableRounds[majorToRound[majorByNum[j-k]]]) { continue }
            myRound = captableRounds[majorToRound[majorByNum[j-k]]];
//            Logger.log("captable/breakdown: found major column for %s: it is %s", row[j], myRound.name);
            break;
          }

		  var asvar = asvar_(row[j]);

          minorByName[myRound.name + asvar] =     j;
          minorByNum [j]  = { round: myRound, minor: asvar };

//          Logger.log("captable/breakdown: we have learned that if we encounter a thingy in column %s it belongs to round (%s) attribute (%s)",
//                                                                                                   j,                    myRound.name, minorByNum[j].minor);
        }
      }
	  // LEARN ABOUT THE ROUND MINOR ATTRIBUTES
      else if (row[0] == "pre-money" ||
          row[0] == "price per share" ||
          row[0] == "discount" ||
          row[0] == "amount raised" ||
          row[0] == "post"
      ) {
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/%s: looking at row[%s], which is %s",
//                               asvar0,            j,        row[j]);
//          Logger.log("captable/%s: if we're able to pull a rabbit out of the hat where we stashed it, round is %s and attribute is %s",
//                               asvar0,                                                      minorByNum[j].round.name, minorByNum[j].minor);
          // learn something useful. er. where do we put the value?
          var myRound = minorByNum[j].round;
		  myRound[asvar0] = myRound[asvar0] || {};
		  // for rows "price per share" and "discount" we save it one layer deeper than we actually need to -- so when you pull it out, dereference the minor col.
          myRound[asvar0][             minorByNum[j].minor] = formatify_(formats[i][j], row[j], sheet, minorByNum[j].minor);
          myRound[asvar0]["_orig_"   + minorByNum[j].minor] = row[j];
          myRound[asvar0]["_format_" + minorByNum[j].minor] = formats[i][j];
		  Logger.log("learned column attribute %s.%s.%s = %s (orig=%s) (format=%s)",
					 myRound.name, row[0], minorByNum[j].minor, myRound[asvar0][minorByNum[j].minor], row[j],
					 formats[i][j]
					);
        }
      }
	  // WE MUST BE DEALING WITH AN INVESTOR!
      else {
		if (row[0] == "") { continue }
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/investor: the investor is %s, and we're looking at row[%s], which is a %s %s",
//                     row[0],                           j,    minorByNum[j].minor,    row[j]);
          // learn something useful. er. where do we put the value?
          var myRound = minorByNum[j].round;
		  if (myRound.new_investors[row[0]] == undefined) {
			myRound.ordered_investors.push(row[0]);
			myRound.new_investors[row[0]] = {};
		  }
          myRound.new_investors[row[0]][minorByNum[j].minor] = formatify_(formats[i][j], row[j], sheet, minorByNum[j].minor);
          myRound.new_investors[row[0]]["_orig_"+minorByNum[j].minor] = row[j];
          myRound.new_investors[row[0]]["_format_"+minorByNum[j].minor] = formats[i][j];
		  Logger.log("learned investor %s.%s.%s = %s (orig=%s) (format=%s)",
					 myRound.name, row[0], minorByNum[j].minor, myRound.new_investors[row[0]][minorByNum[j].minor], row[j],
					 formats[i][j]
					);
        }
      }
    }
  }
//  Logger.log("we have learned about the cap table rounds: %s", captableRounds);
  return captableRounds;
}
//more comments!hgfhgfhgf


// meng suggests: how about we start with an empty cap table, with just a single round in it, for incorporation.
// this could come from some Master tab in some existing spreadsheet, so we don't have to create the thing cell by cell.
//
// TODO: let's devise a Round Object that helps to represent what's in a round.
// that round object could be created independent of a containing capTable.
// Sure, the capTable object will create a bunch of Round objects when parsing an existing capTable.
// but when we want to add a new round to a capTable we can start by creating the Round and telling the capTable "here you go, deal with this".
//
// TODO: let's create an addRoundToCapTable method.
//
// TODO: let's create a createTabForRound method.
//

function importCapTableTemplate(ss_ToImportTo){
  var capTableTemplate = getSheetByURL_(DEFAULT_CAPTABLE_TEMPLATE);

  var forImport_ss = ss_ToImportTo || SpreadsheetApp.getActiveSpreadsheet();//meh, standard check to make function more robust;

  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('Creating New CapTable', 'What would you like to call it?', ui.ButtonSet.OK_CANCEL);

  if(response.getSelectedButton() == ui.Button.OK){
    Logger.log("Sweet, we got confirmation to proceed from the user");
    var copiedSheet = capTableTemplate.copyTo(forImport_ss);
    forImport_ss.setActiveSheet(copiedSheet);
    copiedSheet.setName(response.getResponseText());
    return forImport_ss;
  } else {
    Logger.log("I guess we weren't needed . . .");
    //We should abort the operation. Not sure how to do that. . . return undefined instead
    return undefined;
  }
}


function createCaptable(capTable){
  return importCapTableTemplate(SpreadsheetApp.getActiveSpreadsheet());
//  var captable;
//  var ui = SpreadsheetApp.getUi();
//  var activeSpreadSheet = SpreadsheetApp.getActiveSpreadsheet();
//
//  var captablesheetName = ui.prompt("Enter New Sheet Name: ", ui.ButtonSet.OK_CANCEL);
//  if (captablesheetName.getSelectedButton() == ui.Button.OK){
//    captable = activeSpreadSheet.getSheetByName(captablesheetName) || activeSpreadSheet.insertSheet(captablesheetName);
//    var CapSheet = new capTableSheet_(captable); //creating the capsheettable object
  };
  


  //Create Sheet Title: CAP TABLE
/*  var cell = sheet.getRange(1, 1);
  cell.setValue("CAP TABLE");

  //hardcode catagories
  var catagories = ["round name",
                    "security type",
                    "approximate date",
                    "break it down for me",
                    "pre-money",
                    "price per share",
                    "discount",
                    "amount raised",
                    "post"];

  // meng suggests: make this a method within the capTable_() object.
  var roundArray = getRoundArray(capTable);

  for (var i = 2; i< catagories.length + 2; i++){
    cell = sheet.getRange(i, 1);
	// meng suggests: set the formatting also.
    cell.setValue(catagories[i-2]);
    var roundNumber = 0;

    Logger.log(roundArray);
    var j = 2;
    Logger.log("roundArray.length is " + roundArray.length);
    while (roundNumber < roundArray.length){
      var dataCell = sheet.getRange(i, j);
      var category = cell.getValue();

      if (category == "break it down for me"){
        dataCell = sheet.getRange(i, j, 1, 3);
		// meng suggests: set the formatting also.
        dataCell.setValues([['money', 'shares', 'percentage']]);
      }
      if (category == "round name"){
        category = "name";
      }
      if (category == "amount raised"){
        j += 3;
        roundNumber++;
        continue;
      }

      Logger.log("round number is " + roundNumber);
      Logger.log("category is " + category);
      var dataCellValue = getCategoryData(capTable, roundNumber, category);

      if (!dataCellValue){}
      else if (dataCellValue.constructor == Object){
        var shares = getSharesValue(capTable, roundNumber, category) || "";
        var money = getMoneyValue(capTable, roundNumber, category) || "";
        var percentage = getPercentageValue(capTable, roundNumber, category) || "";
        dataCell = sheet.getRange(i, j, 1, 3);
		// meng suggests: set the formatting also.
        dataCell.setValues([[money, shares, percentage]]);
      }
      else{
        Logger.log("dataCell Value is " + dataCellValue);
        if (dataCellValue){
		  // meng suggests: set the formatting also.
          dataCell.setValue(dataCellValue);
        }
      }
      j += 3;
      roundNumber++;
    }
  }

  //input new investors
  // meng suggests: let's not hardcode Sheet10 -- let's get this passed in from outside.
  var sheetResult = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet10");
  // meng suggests: make these getters methods of the capTable_() object.
  var allInvestors = getNewInvestors(capTable, roundArray.length-1);
  var pivotRow = findCategoryRow(sheetResult, "amount raised");

  Logger.log("pivotRow is " + findCategoryRow(sheetResult, "amount raised"));
  Logger.log("allInvestors array has length: " + allInvestors.length);


  sheetResult.insertRowsBefore(pivotRow, allInvestors.length);
  Logger.log("new row for amount raised is " + findCategoryRow(sheetResult, "amount raised"));
  dataCell = sheet.getRange(pivotRow, 1, allInvestors.length);

  // meng suggests: use a different loop index variable ... var i was used above. some programming styles would prefer allInvestors_i so it's more obvious.
  for (var i = 0; i < allInvestors.length; i++){
    var cell = sheetResult.getRange(i+pivotRow, 1);
    cell.setValue(allInvestors[i]);
    Logger.log("the current investor is " + allInvestors[i]);

    roundNumber = 0;
    j = 2;
	// meng suggests:
	//    var col_offset = 2, col_size = 3;
	//    for (var major_col = 0; major_col < capTable.rounds().length; major_col++) {
	//      var actual_col = major_col * col_size + col_offset;
	//    ...
    while (roundNumber < roundArray.length){
      //check if new investors in round, because of short-circuit we can ask for investor in new_investors without error (neato!)

	  if ("new_investors" in capTable[roundNumber] &&
          allInvestors[i] in capTable[roundNumber]["new_investors"]) {

		// meng suggests: make these getters methods of the capTable_() object.
		// or even create a new Investor object.
        var shares = getNewInvestorMinorValue(capTable, roundNumber, allInvestors[i], "shares") || "";
        Logger.log("Shares for investor: " + shares);
        var money = getNewInvestorMinorValue(capTable, roundNumber, allInvestors[i], "money") || "";
        Logger.log("Money for investor: " + money);
        var percentage = getNewInvestorMinorValue(capTable, roundNumber, allInvestors[i], "percentage") || "";
        Logger.log("Percentage for investor: " + percentage);

		// meng suggests: see the col_offset / col_size discussion above.
        cell = sheetResult.getRange(i + pivotRow, j, 1, 3);//Note that we add 9 for proper offset, there should be a better way and not hardcode it. . .
		// meng suggests: add formatting here.
        cell.setValues([[money, shares, percentage]]);
      }
		// meng suggests: after implementing the col_offset / col_size discussion above, these lines below shouldn't be necessary.
      j+=3;
      roundNumber++;
  }
  }

  // meng suggests: maybe we need an object class for a captable sheet, which know show to do things like findCategoryRow().

  //calculate total
  var newAmountRaisedRow = findCategoryRow(sheetResult, "amount raised");
  var lastColumn = sheet.getLastColumn();
  Logger.log("THIS IS THE LAST COLUMN: %s", lastColumn);
  for (var i = 2; i <= lastColumn; i++){
    if ((i%3 == 0) || (i%3 == 2)){

      var range = newAmountRaisedRow - pivotRow;

      Logger.log("RANGE: %s; COLUMN: %s", range, i);
      var cell = sheetResult.getRange(newAmountRaisedRow, i);
      cell.setFormulaR1C1("=SUM(R[-" + range.toString() + "]C[0]:R[-1]C[0])");
    }
    else {
	  // meng suggests: add formatting here
      var cell1 = sheetResult.getRange(newAmountRaisedRow,   i-1).getValues();
      var cell2 = sheetResult.getRange(newAmountRaisedRow+1, i-1).getValues();
      var cell3 = sheetResult.getRange(newAmountRaisedRow,   i);
	  // meng suggests: can we make this a formula?
      cell3.setValue(cell1/cell2);
    }
  };

  // meng suggests: can we become a method of some more intelligent object class?
  var sharesPostRow = findCategoryRow(sheetResult, "shares, post");
  // meng suggests: maybe a different loop index variable?
  for (var i = 3; i<= lastColumn - 1; i+=3){
    var subTotalShares = sheetResult.getRange(sharesPostRow - 1, i).getValue();
    if ((i == 3) || (i== (lastColumn - 1))){
      var cell = sheetResult.getRange(sharesPostRow, i);
	  // meng suggests: can we make this a formula?
      cell.setValue(subTotalShares);
    }
    else {
      //var lastRoundShares = sheetResult.getRange(sharesPostRow, i-3);
      var cell = sheetResult.getRange(sharesPostRow, i);
      cell.setFormula("=ADD(R[0]C[-3], R[-1]C[0])");
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheetResult);

}
;

//upperRange = pivotRow
//lowerRange = findCategoryRow(sheetResult, "amount raised");
function getAmountRaised(sheet, upperRange, lowerRange, columnCell){
  //sum of all investor for money and shares
  Logger.log("dsfhsdkjfhdskjfhdsfdskjfhdsjkf");
  var range = lowerRange - upperRange;

  Logger.log("RANGE: " + range + "COLUMN: " + columnCell);
  var cell = sheet.getRange(lowerRange, columnCell);
  cell.setFormulaR1C1("=SUM(R[-" + range.toString() + "]C[0]:R[-1]C[0])");
}


function findCategoryRow(sheet, category) {
  var key = category;
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();


  for (var i = 0; i < values.length; i++) {
    if (values[i][0] == key){
      return i + 1;
    };
  }
}

//get functions for each catagory

//returns an array, given round number, gives round name
function getRoundArray(capTable){
  var roundToNumber = []
  //key starts at 0
  for (key in capTable){
    roundToNumber[key] = capTable[key]["name"];
  }
  return roundToNumber
}

//returns the round name, given round number
function getRoundName(capTable, roundNumber){
  var round = getRoundArray(capTable);
  var roundName = round[roundNumber];
  return roundName;
}

//returns a number, given round name, gives round number
function getRoundNumber(capTable, roundName){
  var round = getRoundArray(capTable);
  var roundNumber = round.indexOf(roundName);
  return roundNumber;
}

function getCategoryData(capTable, round, category){
  var key = asvar_(category);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key];
  }
  else{
    return capTable[round][key]
  }
}

function getNewInvestors(capTable, round){
  var key = asvar_("new investors");
  if (typeof round == "string"){
    round = getRoundNumber(capTable, round);
  }
  var newInvestors = []
  var i = 0;
  for (name in capTable[round][key]){
    newInvestors[i] = name;
    i++;
  }
  return newInvestors
}

function getNewInvestorMinorValue(capTable, round, investor, minor){
  var key = asvar_("new investors");
  //Logger.log("LLLLLLLLLL" + capTable[round][key][investor][minor]);
  if (typeof round == "string"){
    Logger.log("ITS THE FIRST ONE");
    var roundNum = getRoundNumber(capTable, round);
    if (minor in capTable[roundNum][key][investor]){
      return capTable[roundNum][key][investor][minor];
    }
    else { return ""};
  }
  else{
    Logger.log("ITS THE SECOND ONE");
    Logger.log("percentage" in capTable[round][key][investor]);
    if (minor in capTable[round][key][investor]){
      Logger.log("Do I exist?" + capTable[round][key][investor]);
      return capTable[round][key][investor][minor];
    }
    else { Logger.log("Do I exist?" + capTable[round][key][investor]); return ""};
  }
}

function getMoneyValue(capTable, round, catagory){
  var key = asvar_(catagory);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key]["money"];
  }
  else{
    return capTable[round][key]["money"];
  }
}

function getSharesValue(capTable, round, catagory){
    var key = asvar_(catagory);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key]["shares"];
  }
  else{
    return capTable[round][key]["shares"];
  }
}

function getPercentageValue(capTable, round, catagory){
    var key = asvar_(catagory);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key]["percentage"];
  }
  else{
    return capTable[round][key]["percentage"];
  }
}
*/

//function round_(name, security, investors, pricePerShare){
//    this.name = name;
//    this.securityType = asvar_(security);
//    //investors =
//
//    if (securityType == "equity of somesort"){
//	//price per share box becomes yellow"
//    };
//
//    this.investors = investors; //investors[] contributed to this round
//    //investors[]
//    //investors = {name: {money: nn,
//    //                    shares: nn,
//    //                    percentage: %%}}
//
//    this.getInvestorByName = function(InvestorName){
//	return investors[InvestorName];
//	//returns the hash of money, shares, percentage
//    };
//
//    this.pricePerShare = pricePerShare;
//
//    //var AmountRaised = [money: 0, shares: 0, percentage: 0];
//
//    this.getAmountRaised = function(){
//	var sumMoney; var sumShares
//	for (investor in investors){
//	    sumMoney += investors[investor].money;
//	    sumShares += investors[investor].shares;
//	};
//	AmountRaised[0] = sumMoney;
//	AmountRaised[1] = sumShares;
//	//money = total of all investors money
//	//shares = total of all shares distributed
//	//percentage = shares raised this round/postShares. will be modified in capTable.
//	return AmountRaised
//    };
//}

var capToTerm = {"amount raised" : "Amount Raising:",
                 "pre-money" : "Pre-Money Valuation:",
                 "security type" : "Security Type:",
                }

function capTableSheet_(captablesheet){
  this.spreadSheet = SpreadsheetApp.getActiveSpreadsheet();
  this.captablesheet = captablesheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Cap Table");
  
  this.addMajorColumn = function(name){//I think sending in a round makes more sense, but for now just pass in the name of the round
    name = name || "Blank Round";
    var CapSheet = this.captablesheet;
    var data = CapSheet.getDataRange().getValues();
    
    var roundNameRow = this.getCategoryRowCaptable("round name");
    var roundNames = data[roundNameRow - 1];//array starts at 0, actual rows start at 1

    Logger.log("The sheet that you are using is: " + CapSheet.getName() );
    Logger.log("what we are looking at is: " + roundNames);

    //right now, the assumption is that the last column is TOTAL and is written the leftmost minor column of a major column
    if(roundNames[roundNames.length - 3] == "TOTAL"){
      Logger.log("got gucci real fast");

      
      //WE NEED TO TOTALLY CLEAN ALL OF THIS UP TO LOOK PRETTY
      CapSheet = CapSheet.insertColumnsBefore((roundNames.length - 3) + 1, 3);//columns start at 1, so +1
      //For whatever reason, CapSheet loses its reference after performing this action
      
      var prevMajorColumn = CapSheet.getRange(1, roundNames.length - 6 + 1, CapSheet.getLastRow() , 3);
      var destination = CapSheet.getRange(1, roundNames.length - 3 + 1);
      prevMajorColumn.copyTo(destination);
      //We can copy and paste the column to the RIGHT of newMajorColumn into newMajorColumn
      
      Logger.log("finished the copy and paste");
      var cell = CapSheet.getRange(2, roundNames.length - 2);
      cell.setValue(name);
      
      //clear highlights so that they we can highlight the important cells later
      CapSheet.getRange(2, roundNames.length - 3 + 1, CapSheet.getLastRow(), 3)
          .setBackground("white");
      
    }
    else{
      Logger.log("Error: Make sure that your active sheet is the Cap Table");
    };

  };
  
  this.setTotal = function(){
    Logger.log("setting total")
    var sheet = this.captablesheet;
    var TotalColumn = this.getRoundColumnByName("TOTAL");

	// in future it might be possible to have a class to represent the TOTAL column,
	// and subsume this complexity into methods of that class,
	// but for now we just grope the values directly.
	
    var investorBeginRow = this.getCategoryRowCaptable("discount") + 1;
    var investorEndRow = this.getCategoryRowCaptable("amount raised") -1;
    Logger.log("investors exist beween rows " + investorBeginRow + " and " + investorEndRow);
    
    for (var row = investorBeginRow; row <= investorEndRow; row ++){
      var sumMoney = "=";
      var sumShares = "=";
      for (var mcol = 2; mcol < TotalColumn; mcol += 3){
        var mrange = sheet.getRange(row, mcol);
        sumMoney = sumMoney + "+" + mrange.getA1Notation();
        Logger.log("sumMoney looks like this: " + sumMoney);
        
        var srange = sheet.getRange(row, mcol + 1);
        sumShares = sumShares + "+" + srange.getA1Notation();
        Logger.log("sumShares looks like this: " + sumShares);
      }
      var mcell = sheet.getRange(row, TotalColumn);
      mcell.setFormula(sumMoney);
      
      var scell = sheet.getRange(row, TotalColumn + 1);
      scell.setFormula(sumShares);
    }
    
    //update post, post should match
    var post = this.getCategoryRowCaptable("post"); 
    var postCell = sheet.getRange(post, TotalColumn);
    var postMoney = "=";
    var postShares = "=";
    
    for (var pcol = 2; pcol < TotalColumn; pcol += 3){
      var prange = sheet.getRange(post - 1, pcol);
      postMoney = postMoney + "+" + prange.getA1Notation();
      Logger.log("sumMoney looks like this: " + postMoney);
      
      var srange = sheet.getRange(row, pcol + 1);
      postShares = postShares + "+" + srange.getA1Notation();
      Logger.log("sumShares looks like this: " + postShares);
    }
    
    postCell.setFormula(postMoney);
    postCell = sheet.getRange(post, TotalColumn + 1);
    postCell.setFormula(postShares);
    
  }
  
  //checks all? functions in the cap table to make sure they are pointing in the right place
  //or should we just pass in a round to be rewired? It may the case that TOTAL and most recent column need to be change, nothing else
  this.rewireColumns = function(){
      //We now need to find the column number with the word TOTAL
    var TotalColumn = this.getRoundColumnByName("TOTAL"); //not quite sure why we need this....
      //You can copy the code from addMajorColumn that finds the row and column of TOTAL
      var sheet = this.captablesheet;
      var data = sheet.getDataRange().getValues();
    
      var roundNameRow = this.getCategoryRowCaptable("round name");
      var roundNames = data[roundNameRow - 1];//array starts at 0, actual rows start at 1
      //copied from addMajorColumn
    //Logger.log(roundNames);
    
    
    var amountRaisedRow = this.getCategoryRowCaptable("amount raised");
    var investorBeginRow = this.getCategoryRowCaptable("discount") + 1;
    
    for each (var round in roundNames){
      if (round == "round name"){
        continue;
      }
      var col = this.getRoundColumnByName(round);
      
      //for the money category
      var cell = sheet.getRange(amountRaisedRow, col);
      cell.setFormula("=SUM(INDIRECT(ADDRESS(" + investorBeginRow + ",COLUMN())&" + '":"' + "&ADDRESS(ROW()-1,COLUMN())))");
      
      //for the shares category
      cell = sheet.getRange(amountRaisedRow, col+1);
      cell.setFormula("=SUM(INDIRECT(ADDRESS(" + investorBeginRow + ",COLUMN())&" + '":"' + "&ADDRESS(ROW()-1,COLUMN())))");
    }
      
      //Logger.log("The row we are looking at is: %s \nand it looks like this: %s", roundNameRow, roundNames);

      //The apparent way to do this would be a for loop, since the money column is already set
      //var totalRows = sheet.getLastRow();//something like this
      //for(var i_setFunction = 0; i_setFunction < totalRows; i_setFunction++){//The for-loop may no necessarily begin at 0. . .
	  //I insist that we call the index counter something other than 'i' for readability's sake, you can change it if you want
	  //The coordinate of the current cell we should be looking at should be something along the lines of (i_setFunction, roundNames.length - 3)
	  //I think for setting formulas, R1C1 notation would be better
	  //You have two choices, of adding each cell directly or using the SUMIF operation, albeit a little bit more complicated
	  //I think Meng prefers direct addition
      //}
  }
  
    this.getCategoryRowCaptable = function(category) {
      var sheet = this.captablesheet;
      var key = category;
      var dataRange = sheet.getDataRange();
      var values = dataRange.getValues();

      for (var i = 0; i < values.length; i++) {
        if (values[i][0] == key){
          return i + 1;
        };
      }
    };
  
  this.getCategoryRowTermSheet = function(round, category){
    //returns the corresponding catetory row in term sheet
    //Logger.log("It is suppose to print for category " + capToTerm[category]);
    var termCategory = capToTerm[category] || titleCase(category) + ":";
    var termsheet = this.spreadSheet.getSheetByName(round);
    var lastRow = termsheet.getLastRow();
    Logger.log("the last row in this spreadsheet is " + lastRow);
    var cell;
    for (var row = 1; row <= lastRow; row++){
      cell = termsheet.getRange(row, 1);
      Logger.log("the cell value is " + cell.getValue());
      if (cell.getValue() == termCategory){
        Logger.log("HURRAY FOUND IT, and it is row " + row);
        return row;
      }
    }
  };
  
  this.getRoundColumnByName = function(round){
    //returns the corresponding major column given the round name
    //still needs to be tested
    Logger.log("I have entered the function");
    var sheet = this.captablesheet;
    var numCol = sheet.getLastColumn();
    for (var column = 1; column <= numCol; column++){
      Logger.log("I am checking column " + column);
      var cell = sheet.getRange(2, column);
      var value = cell.getValue();
      if (value == round){
        return column;
      }
    }
    Logger.log("Round does not exist");
    
  };
  
  this.setReference = function(origin, round, category){
    var sheetModified;
    var categoryRow;
    var roundCol;
    if (origin == "Cap Table"){
      Logger.log("We are sending info from Cap Table");
      sheetModified = this.spreadSheet.getSheetByName(round);
      categoryRow = this.getCategoryRowCaptable(category);
      roundCol = this.getRoundColumnByName(round);
      var termrow = this.getCategoryRowTermSheet(round, category);
      
      var originCell = this.captablesheet.getRange(categoryRow, roundCol);
      var A1Notation = originCell.getA1Notation();
      var cell = this.spreadSheet.getSheetByName(round).getRange("B" + termrow);
      cell.setFormula("= 'Cap Table'!" + A1Notation);
      
      
    }
    else{
      sheetModified = this.captablesheet;
      categoryRow = this.getCategoryRowTermSheet(round, category);
      var capRow = this.getCategoryRowCaptable(category);
      roundCol = this.getRoundColumnByName(round);
      
      Logger.log("termrow is: %s, caprow is: %s, capcol is: %s", termrow, caprow, capcol);
      var cell = this.captablesheet.getRange(capRow, roundCol);
      Logger.log("this is the fomula being set: " + "= '" + round + "' !B" + categoryRow);
      cell.setFormula("= '" + round + "' !B" + categoryRow);
    }
  }
  
    
  //this.getNumRowCapSheet() = function(){
 //   return this.captablesheet.getLastRow();
 // }
 //// 
 // this.getNumRowTermSheet() = function(round){
   // return this.spreadsheet.getSheetByName(round).getLastRow();
 // }
};

function insertNewRound(capsheet){
  
  var capSheet = new capTableSheet_(capsheet);
  
  var round = newTermSheet("Round Name: ");
  
  capSheet.addMajorColumn(roundName.getResponseText());
  
  capSheet.setReference(round, round, "security type");
  
  capSheet.setReference('Cap Table', round, "pre-money");
  /*
  var numRow = capSheet.getNumRowTermSheet(round);
  var termSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(round);
  
  var termCategories;
  for (var tRow = 1; tRow <= termSheet.getLastRow(); tRow++){
    termCategories.push(termSheet.getRange(tRow, 1).getValue());
  };
  
  for (var row = 1; row <= numRow; row++){
    var cell = capsheet.getRange(row, 1).getValue();
    if ((cell in capToTerm) || (titleCase(cell) in termCategories)) {
      setReference('Cap Table', round, cell);
    }
  }
  */
  
  //set correct security type:
  
  //set references
  //references include: pre-money, money invested by each investor
  
  //set formulas: 
  //pre-money shares, percentages, amount raised, post
  
  //add to roles and entities
  
  //adjust TOTAL
}

//regenerate term sheet from CAP Table
function regenerateTermSheet(round, captable){
  newTermSheet("regenerate round: ");
};

function newTermSheet(prompt){
  var spreadSheet = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var roundName = ui.prompt(prompt, ui.ButtonSet.OK_CANCEL);
  var round = roundName.getResponseText();
  Logger.log("return round name: " + round);
  var termTemplate = getSheetByURL(DEFAULT_TERM_TEMPLATE);

  if (roundName.getSelectedButton() == ui.Button.OK){
    
	var newTermSheet = termTemplate.copyTo(spreadSheet);
	spreadSheet.setActiveSheet(newTermSheet);
	newTermSheet.setName(round);
  };
  
  return round;
};


//----------------------------------------STILL WORKING ON THIS SHIT-----------------------------------//
function addColumn(captablesheet){
  var ss_forAdd = new capTableSheet_(captablesheet);
    ss_forAdd.addMajorColumn();
    ss_forAdd.setTotal();
    ss_forAdd.rewireColumns() //<--- Write the Function
}
//----------------------------------        ***************        ------------------------------------//

function updateTotal(){
  var captableSheet = SpreadsheetApp.getActiveSheet();
  Logger.log("starting resetTotals using sheet %s", captableSheet.getSheetName());
  var capSheet = new capTableSheet_(captableSheet);
  capSheet.setTotal();
}

function CapTableTester(){
  Logger.log("starting tester");
  var SpreadSheet = SpreadsheetApp.getActiveSpreadsheet();
  var captableSheet = SpreadSheet.getSheetByName("Copy of Cap Table");
  //var termsheet = SpreadSheet.getSheetByName("Creation of Class F");
  //var cap = new capTable_(termsheet, captableSheet);
  
  //Logger.log(capSheet.getCategoryRowTermSheet("Bridge Round", "price per share"));
 // captableSheet = createCaptable();
  var capSheet = new capTableSheet_(captableSheet);
  capSheet.setTotal();
  //capSheet.rewireColumns();
  //Logger.log("I have made it into a capTableSheet Object");
  //capSheet.addMajorColumn("wut wut wut");
  //capSheet.setReference("Cap Table", "Bridge Round", "pre-money");
  //Logger.log("the deed is done");
}

