/* legaleseMain MANIFEST
 *
 * inside a legaleseMain project file you will find multiple scripts:
 * legaleseMain
 * svg
 * owl
 * esop
 * captable
 *
 * the subsidiary scripts represent chunks of functionality that reside in separate files both in the source repo and in the production google app.
 * why? because that's better than having everything in one file, that's why.
 *
 * TODO
 *
 * does the form submission trigger DTRT if there are multiple forms all callbacking to the same formsubmit?
 *
** import the termsheets from "How to invest in a JFDI Startup"
 *
**  reduce the security threat surface -- find a way to make this work with OnlyCurrentDoc.
 *  https://developers.google.com/apps-script/guides/services/authorization
 *
 *  the risk is that a malicious commit on the legalese codebase will embed undesirable content in an xml template file
 *  which then runs with user permissions with access to all the user's docs. this is clearly undesirable.
 *
 *  a functionally equivalent man-in-the-middle attack would intercept the UrlFetch() operation and return a malicious XML template file,
 *  either attacking obtainTemplate or INCLUDE(Available Templates).
 *
 *  lodging the XML templates inside the app itself is a seemingly attractive alternative, but it reduces to the same threat scenario because that data
 *  has to populate from somewhere in the first place.
 *
 *  we should require that all committers with access to GitHub must have 2FA.
 *
 *  ideally we would reduce the authorization scope of this script to only the current doc.
 *  but we need a way to share the resulting PDF with the user without access to everything in Drive!
*/


// ---------------------------------------------------------------------------------------------------- state
//
// a brief discussion regarding state.
//
// A spreadsheet may contain one or more sheets with deal-terms and entity particulars.
//
// When the user launches a routine from the Legalese menu, the routine usually takes its configuration from the ActiveSheet.
//
// But some routines are not launched from the Legalese menu. The form's submission callback writes to a sheet. How will it know which sheet to write to?
//
// Whenever we create a form, we shall record the ID of the then activeSheet into a UserProperty, "formActiveSheetId".
// Until the form is re-created, all submissions will feed that sheet.
//
// What happens if the user starts working on a different sheet? The user may expect that form submissions will magically follow their activity.
//
// To correct this impression, we give the user some feedback whenever the activeSheet is not the formActiveSheet.
//
// The showSidebar shall check and complain.
//
// That same test is also triggered when a function is called: if the activesheet is different to the form submission sheet, we alert() a warning.
//
//


var DEFAULT_AVAILABLE_TEMPLATES = "https://docs.google.com/spreadsheets/d/1rBuKOWSqRE7QgKgF6uVWR9www4LoLho4UjOCHPQplhw/edit#gid=981127052";
var DEFAULT_CAPTABLE_TEMPLATE = "https://docs.google.com/spreadsheets/d/1rBuKOWSqRE7QgKgF6uVWR9www4LoLho4UjOCHPQplhw/edit#gid=827871932";

// ---------------------------------------------------------------------------------------------------------------- onOpen
/**
 * Adds a custom menu to the active spreadsheet.
 * The onOpen() function, when defined, is automatically invoked whenever the
 * spreadsheet is opened.
 * For more information on using the Spreadsheet API, see
 * https://developers.google.com/apps-script/service_spreadsheet
 */
function onOpen(addOnMenu, legaleseSignature) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getActiveSheet();

  addOnMenu = addOnMenu || SpreadsheetApp.getUi().createAddonMenu();

  addOnMenu
	.addItem("Create Form", "legaleseMain.setupForm")
	.addItem("Generate PDFs", "legaleseMain.fillTemplates")
	.addItem("Add a new Investor or other Party", "legaleseMain.addEntity")
	.addItem("Add a Round to the Cap Table", "legaleseMain.addRound");

  if (legaleseSignature && legaleseSignature._loaded) {
	var echosignService = legaleseSignature.getEchoSignService();
	if (echosignService != null) {
	  addOnMenu.addItem("Send to EchoSign", "legaleseSignature.uploadAgreement");
	}
  }

  addOnMenu.addItem("Clone Spreadsheet", "legaleseMain.cloneSpreadsheet");
  addOnMenu.addToUi();

  // when we release this as an add-on the menu-adding will change.

//  resetDocumentProperties_("oauth2.echosign");

// next time we uncomment this we need to take legalese.uniq.x into account
// resetDocumentProperties_("legalese.folder.id");
// resetDocumentProperties_("legalese.rootfolder");

  PropertiesService.getDocumentProperties().deleteProperty("legalese.muteFormActiveSheetWarnings");

  // if we're on the Natural Language UI, reset C2's data validation to the appropriate range.
  if (sheet.getName() == "UI") {
	var sectionRange = sectionRangeNamed(sheet,"Entity Groups");
	var myRange = sheet.getRange(sectionRange[0], 2, sectionRange[1]-sectionRange[0]+1, 1);
	Logger.log("resetting C2 datavalidation range to " + myRange.getA1Notation());
	setDataValidation(sheet, "C2", myRange.getA1Notation());
  }

  if (legaleseSignature && legaleseSignature._loaded) {
	legaleseSignature.showSidebar(sheet);
  }
};


// todo: rethink all this to work with both controller and native sheet mode. now that we save the sheetid into the uniq'ed

function templateActiveSheetChanged_(sheet) {
  var templateActiveSheetId = PropertiesService.getDocumentProperties().getProperty("legalese.templateActiveSheetId");
  if (templateActiveSheetId == undefined)          { return false }
  if (                sheet == undefined)          { return false }
  Logger.log("templateActiveSheetChanged: comparing %s with %s, which is %s",
			 templateActiveSheetId, sheet.getSheetId(),
			 templateActiveSheetId == sheet.getSheetId()
			);
  return (templateActiveSheetId != sheet.getSheetId());
}

function muteTemplateActiveSheetWarnings_(setter) {
  if (setter == undefined) { // getter
	var myprop = PropertiesService.getDocumentProperties().getProperty("legalese.muteTemplateActiveSheetWarnings");
	if (myprop != undefined) {
	  return JSON.parse(myprop);
	}
	else {
	  return false;
	}
  }
  else {
	PropertiesService.getDocumentProperties().setProperty("legalese.muteTemplateActiveSheetWarnings", JSON.stringify(setter));
  }
}

// ---------------------------------------------------------------------------------------------------------------- readRows
/**
 * populate a number of data structures, all kept in "toreturn".
 * you can think of this as a constructor, basically, that represents the sheet, but is agnostic as to the specific data.parties that are needed by each template.
 * the data.parties get filled in by the template matcher, because different templates involve different parties.
 *
 * the ENTITIES go into entitiesByName
 * the TERMS go into data.* directly.
 */
function readRows(sheet, entitiesByName) {
  Logger.log("readRows: will use sheet " + sheet.getName());
  var rows = sheet.getDataRange();
  var numRows  = rows.getNumRows();
  var values   = rows.getValues();
  var formulas = rows.getFormulas();
  var formats  = rows.getNumberFormats();

  var toreturn =   { terms            : {},
					 config           : {},
					 entitiesByName   : entitiesByName,
					 _origentityfields: [],
					 _entityfields    : [],
					 _last_entity_row : null,
					 // principal gets filled in later.
					 availableTemplates: [],
				   };

  var terms = toreturn.terms;
  var config = toreturn.config;
  var origentityfields = toreturn._origentityfields; // used by the form
  var entityfields = toreturn._entityfields;
  var principal, roles = {};

  var section = "prologue";
  var entityfieldorder = [];    // table that remaps column number to order-in-the-form
  var templatefieldorder = [];  // table that remaps column number to order-in-the-form
  // maybe we should do it this way and just synthesize the partygroups as needed, along with any other filters.
  var previous = [];

  Logger.log("readRows: starting to parse %s / %s", sheet.getParent().getName(), sheet.getSheetName());

// get the formats for the B column -- else we won't know what currency the money fields are in.
  var term_formats = sheet.getRange(1,2,numRows).getNumberFormats();

  var es_num = 1; // for email ordering the EchoSign fields

  var seen_entities_before = false;

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];
	// process header rows
	if (row.filter(function(c){return c.length > 0}).length == 0) { Logger.log("readRows: row %s is blank, skipping", i);  continue; }
	else 	Logger.log("readRows: row " + i + ": processing row "+row[0]);
    if      (row[0] == "KEY TERMS" ||
			 row[0] == "TERMS") { section="TERMS"; continue; }
    else if (row[0] == "IGNORE"        ||
			 row[0] == "CAP TABLE"     ||
			 row[0] == "CONFIGURATION" ||
			 row[0] == "LINGUA"        ||
			 row[0] == "LOOKUPS"       ||
			 row[0] == "ROLES") { section = row[0]; continue; }
	else if (row[0] == "INCLUDE") {
	  // the typical startup agreement sheet INCLUDEs its Entities sheet which INCLUDEs JFDI.2014's Entities which INCLUDEs JFDI.Asia's Entities
	  var include_sheet;
	  var formula = formulas[i][1];
	  if (formula) {
		// =HYPERLINK("https://docs.google.com/a/jfdi.asia/spreadsheets/d/1Ix5OYS7EpmEIqA93S4_JWxV1OO82tRM0MLNj9C8IwHU/edit#gid=1249418813","Entities JFDI.2014")
		include_sheet = hyperlink2sheet_(formula);
	  }
	  else if (row[1].match(/https?:/)) {
		include_sheet = hyperlink2sheet_(row[1]);
	  } else {
		include_sheet = sheet.getParent().getSheetByName(row[1]);
	  }

	  Logger.log("readRows(%s): encountered INCLUDE %s", sheet.getSheetName(), row[1]);
	  if (include_sheet == undefined) { throw("unable to fetch included sheet " + row[1]) }

	  var includedReadRows = readRows(include_sheet, entitiesByName);
	  Logger.log("readRows(%s): back from INCLUDE %s; returned principal = %s",
				 sheet.getSheetName(), row[1], includedReadRows.principal ? includedReadRows.principal.name : undefined);
	  // hopefully we've learned about a bunch of new Entities directly into the entitiesByName shared dict.
	  // we usually throw away the returned object because we don't really care about the included sheet's terms or config.

	  // one may also INCLUDE an Available Templates sheet. if one does so, the default Available Templates sheet will NOT be loaded
	  // unless you explicitly load it.
	  // load an included availableTemplate. also, update the default loading behaviour so it only loads in an actual sheet not an included sheet.

	  if (includedReadRows.availableTemplates.length > 0) {
		// TODO: overwrite existing templates, don't just concatenate.
		Logger.log("readRows(%s): back from INCLUDE %s; absorbing %s new templates",
				   sheet.getSheetName(), row[1], includedReadRows.availableTemplates.length);
		toreturn.availableTemplates = toreturn.availableTemplates.concat(includedReadRows.availableTemplates);
	  }
	  if (principal == undefined) { principal = includedReadRows.principal }

	  if (row[2] != undefined && row[2].length) {
		// if row[2] says "TERMS" then we include the TERMS as well.
		if (row[2] == "TERMS") {
		  Logger.log("readRows(%s): including TERMS as well.", sheet.getSheetName());
		  for (var ti in includedReadRows.terms) {
			terms[ti] = includedReadRows.terms[ti];
		  }
		}
		else {
		  Logger.log("WARNING: readRows(%s): unexpected row[2]==%s ... wtf. should only be TERMS if anything", sheet.getSheetName(), row[2]);
		}
	  }

	  continue;
	}
    else if (row[0] == "PARTYFORM_ORDER") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||!row[ki]){continue}
																				  entityfieldorder[ki] = row[ki];
																				  // Logger.log("readRows: PARTYFORM_ORDER: entityfieldorder[%s] = %s", ki, row[ki]);
																				  origentityfields[entityfieldorder[ki]] = origentityfields[entityfieldorder[ki]]||{};
																				  origentityfields[entityfieldorder[ki]].column = parseInt(ki)+1;
																				  origentityfields[entityfieldorder[ki]].row    = i+1;
																				  // Logger.log("readRows: learned that field with order "+row[ki]+ " is in row %s column %s ", origentityfields[entityfieldorder[ki]].row, origentityfields[entityfieldorder[ki]].column);
																				}
											continue;
										  }
    else if (row[0] == "PARTYFORM_HELPTEXT") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined){continue}
																					 origentityfields[entityfieldorder[ki]].helptext = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_ITEMTYPE") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined){continue}
																					 origentityfields[entityfieldorder[ki]].itemtype = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_DEFAULT") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined||row[ki].length==0){continue}
																					// Logger.log("readRows: learned default value for %s = %s", entityfieldorder[ki], row[ki]);
																					 origentityfields[entityfieldorder[ki]]["default"] = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_REQUIRED") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined){continue}
																					 // Logger.log("readRows: line "+i+" col "+ki+": learned that field with order "+entityfieldorder[ki]+ " has required="+row[ki]);
																					 origentityfields[entityfieldorder[ki]].required = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "ENTITIES" || row[0] == "PARTIES")   {
	  section = "ENTITIES";
	  if (! seen_entities_before) {
		seen_entities_before = true;
		entityfields = row;
		while (row[row.length-1] === "") { row.pop() }

		for (var ki in entityfields) {
		  if (ki < 1 || row[ki] == undefined) { continue }
          origentityfields[entityfieldorder[ki]] = origentityfields[entityfieldorder[ki]] || {};
          origentityfields[entityfieldorder[ki]].fieldname = row[ki];
		  // Logger.log("readRows: learned origentityfields["+entityfieldorder[ki]+"].fieldname="+row[ki]);
          entityfields[ki] = asvar_(entityfields[ki]);
		  // Logger.log("readRows(%s): recorded entityfield[%s]=%s", sheet.getSheetName(), ki, entityfields[ki]);
		}
	  }
	  continue;
	}
	else if (row[0] == "AVAILABLE TEMPLATES") {
	  section = row[0];
	  templatefields = [];
	  Logger.log("we got an Available Templates section heading");
	  while (row[row.length-1] === "") { row.pop() }

	  for (var ki in row) {
		if (ki < 1 || row[ki] == undefined) { continue }
        templatefields[ki] = asvar_(row[ki]);
		Logger.log("readRows(%s): learned templatefields[%s]=%s", sheet.getSheetName(), ki, templatefields[ki]);
	  }
	  continue;
	}

	// not a section header row. so process data rows depending on what section we're in
    if (section == "TERMS") {
      if ( row[0].length == 0) { continue }

	  // TODO: do we need to ignore situations where row[0] !~ /:$/ ? subsection headings might be noisy.
	  var asvar = asvar_(row[0]);
      terms[           asvar] = formatify_(term_formats[i][0], row[1], sheet, asvar);
	  // formatify_() returns a string. if you want the original value, get it from
	  terms["_orig_"       + asvar] = row[1];
	  terms["_format" + asvar] = term_formats[i][0];
	  Logger.log("readRows(%s): TERMS: %s = %s --> %s (%s)", sheet.getSheetName(), asvar, row[1], terms[asvar], (terms[asvar]==undefined?"undef":terms[asvar].constructor.name));
    }
	else if (section == "ROLES") { // principal relation entity. these are all strings. we attach other details
	  var relation  = asvar_(row[0]);
	  var entityname    = row[1];

	  if (relation == "ignore") { Logger.log("ignoring %s line %s", relation, row[1]); continue }

	  roles[relation] = roles[relation] || [];

	  var matches; // there is similar code elsewhere in buildTemplate()
	  if (matches = entityname.match(/^\[(.*)\]$/)) {
		// Shareholder: [Founder]
		// means all founders are also shareholders and we should populate the Shareholder parties accordinlgy

		var extendedAttrs = {};
		if (row[2]) {
		  Logger.log("WARNING: readRows(%s): [merge] syntax learning extended attributes.", sheet.getSheetName());

		  for (var role_x = 2; role_x < row.length; role_x+=2) {
			if (row[role_x] && row[role_x+1] != undefined) {
			  Logger.log("ROLES: [merge] learning extended attribute %s = %s", asvar_(row[role_x]), formatify_(formats[i][role_x+1], row[role_x+1], sheet));
			  extendedAttrs[             asvar_(row[role_x])] = formatify_(formats[i][role_x+1], row[role_x+1], sheet, asvar_(row[role_x]));
			  extendedAttrs["_format_" + asvar_(row[role_x])] = formats[i][role_x+1];
			  extendedAttrs["_orig_"   + asvar_(row[role_x])] = row[role_x+1];
			}
		  }
		  Logger.log("WARNING: readRows(): [merge] syntax learned extended attributes: %s", extendedAttrs);
		}
		
		var to_import = asvar_(matches[1]);
		
		// TODO: sanity check so we don't do a reflexive assignment

		Logger.log("readRows(%s):         ROLES: merging role %s = %s", sheet.getSheetName(), relation, to_import);
		if (! (roles[to_import] && roles[to_import].length)) {
		  Logger.log("readRows(%s):         ERROR: roles[%s] is useless to us", sheet.getSheetName(), to_import);
//		  Logger.log("readRows(%s):         ERROR: roles[] has keys %s", sheet.getSheetName(), roles.keys());
		  Logger.log("readRows(%s):         ERROR: roles[] has keys %s", sheet.getSheetName(), Object.getOwnPropertyNames(roles));
		  Logger.log("readRows(%s):         ERROR: maybe we can find it under the principal's roles?");

		  // TODO: note that the import is incomplete because you don't get _format_ and _orig_.
		  // in the future we should get this all cleaned up with a properly OOPy sheet management system.
		  if (principal.roles[to_import] && principal.roles[to_import].length) {
			Logger.log("readRows(%s):         HANDLED: found it in principal.roles", sheet.getSheetName());
			if (Object.keys(extendedAttrs).length) {
			  Logger.log("readRows(%s):         applying extended Attributes to %s %s parties", sheet.getSheetName(), principal.roles[to_import].length, to_import);
			  for (var ti = 0; ti<principal.roles[to_import].length; ti++) {
				for (var k in extendedAttrs) { entitiesByName[principal.roles[to_import][ti]][k] = extendedAttrs[k];
											   Logger.log("readRows(%s):      %s.%s = %s", sheet.getSheetName(), principal.roles[to_import][ti], k, extendedAttrs[k]);
											 }
			  }
			}
			roles[relation] = roles[relation].concat(principal.roles[to_import]);
		  }
		  continue;
		}
		else {
		  if (Object.keys(extendedAttrs).length) {
			Logger.log("readRows(%s):         applying extended Attributes", sheet.getSheetName());
			for (var ti = 0; ti<roles[to_import].length; ti++) {
			  for (var k in extendedAttrs) { entitiesByName[roles[to_import][ti]][k] = extendedAttrs[k] }
			}
		  }

		  Logger.log("readRows(%s):         ROLES: before, roles[%s] = %s", sheet.getSheetName(), relation, roles[relation]);
		  roles[relation] = roles[relation].concat(roles[to_import]);
		  Logger.log("readRows(%s):         ROLES: after, roles[%s] = %s", sheet.getSheetName(), relation, roles[relation]);
		}
	  }
	  else {
		var entity = entitiesByName[entityname];
		roles[relation].push(entityname);
		Logger.log("readRows(%s):         ROLES: learning party role %s = %s", sheet.getSheetName(), relation, entityname);

		for (var role_x = 2; role_x < row.length; role_x+=2) {
		  if (row[role_x] && row[role_x+1] != undefined) {
			Logger.log("ROLES: learning attribute %s.%s = %s", entityname, asvar_(row[role_x]), formatify_(formats[i][role_x+1], row[role_x+1], sheet));
			entity[asvar_(row[role_x])] = formatify_(formats[i][role_x+1], row[role_x+1], sheet, asvar_(row[role_x]));
			entity["_format_" + asvar_(row[role_x])] = formats[i][role_x+1];
			entity["_orig_"   + asvar_(row[role_x])] = row[role_x+1];
		  }
		}
	  }
	}
    else if (section == "AVAILABLE TEMPLATES") {
	  if (row[0].toLowerCase().replace(/[: ]/g,"") == "ignore") { continue }
	  var template = { _origin_spreadsheet_id:sheet.getParent().getId(),
					   _origin_sheet_id:sheet.getSheetId(),
					   _spreadsheet_row:i+1,
					   parties: {to:[],cc:[]},
					 };
      for (var ki in templatefields) {
        if (ki < 1) { continue }
        var k = templatefields[ki];
		var v = row[ki];
		switch (k) {
		case "to":
		case "cc":
		  template.parties[k] = v.split(','); break;
		default: template[k] = v;
		}
	  }
	  toreturn.availableTemplates.push(template);
	}
    else if (section == "ENTITIES") {
      var entity = { _origin_spreadsheet_id:sheet.getParent().getId(),
					 _origin_sheet_id:sheet.getSheetId(),
					 _spreadsheet_row:i+1,
					 roleEntities: function(roleName) { return this.roles[roleName].map(function(n){return entitiesByName[n]}) }
				   };
      var entity_formats = sheet.getRange(i+1,1,1,row.length).getNumberFormats();

      var coreRelation = asvar_(row[0]);
	  if (coreRelation == undefined || ! coreRelation.length) { continue }
	  if (coreRelation.toLowerCase() == "ignore") { Logger.log("ignoring %s line %s", coreRelation, row[1]); continue }

	  toreturn._last_entity_row = i;

      for (var ki in entityfields) {
        if (ki < 1) { continue }
        var k = entityfields[ki];
        var v = formatify_(entity_formats[0][ki], row[ki], sheet, k);
        entity[k] = v;
		entity["_format_" + k] = entity_formats[0][ki];
		entity["_orig_"   + k] = row[ki];
		if (v && v.length) { entity["_"+k+"_firstline"] = v.replace(/\n.*/g, ""); }
//		Logger.log("INFO: field %s, ran formatify_(%s, %s) (%s), got %s (%s)",
//				   k, entity_formats[0][ki], row[ki], (row[ki] != undefined ? row[ki].constructor.name : "undef"), v, v.constructor.name);
      }

	  // all coreRelation relations in the ENTITIES section are defined relative to the principal, which is hardcoded as the first Company to appear
	  if (coreRelation == "company" && principal == undefined) { principal = entity }

  // connect up the parties based on the relations learned from the ROLES section.
  // this establishes PRINCIPAL.roles.RELATION_NAME = [ party1, party2, ..., partyN ]
  // for instance, companyParty.roles.shareholder = [ alice, bob ]
      Logger.log("readRows: learning entity (core relation = %s), %s", coreRelation, entity.name);
	  roles[coreRelation] = roles[coreRelation] || [];
	  roles[coreRelation].push(entity.name);

	  if (entitiesByName[entity.name] != undefined) {
		Logger.log("WARNING: entity %s was previously defined somewhere in the include chain ... not clobbering.");
	  } else {
		// Define Global Parties Entity
		entitiesByName[entity.name] = entity;
	  }
    }
	else if (section == "CONFIGURATION") {

	  // each config row produces multiple representations:
	  // config.columna.values is an array of values -- if columna repeats, then values from last line only
	  // config.columna.dict is a dictionary of b: [c,d,e] across multiple lines

//	  Logger.log("CONF: row " + i + ": processing row "+row[0]);
	  
	  // populate the previous
	  var columna = asvar_(row[0]) || previous[0];
	  if (columna == "template") { columna = "templates"; Logger.log("CONF: correcting 'template' to 'templates'"); }
	  previous[0] = columna;

//	  Logger.log("CONF: columna="+columna);

	  config[columna] = config[columna] || { asRange:null, values:null, dict:{}, tree:{} };
//	  Logger.log("CONF: config[columna]="+config[columna]);

	  config[columna].asRange = sheet.getRange(i+1,1,1,sheet.getMaxColumns());
//	  Logger.log("CONF: " + columna+".asRange=" + config[columna].asRange.getValues()[0].join(","));

	  var rowvalues = config[columna].asRange.getValues()[0];
	  while (rowvalues[rowvalues.length-1] === "") { rowvalues.pop() }
//	  Logger.log("CONF: rowvalues = %s", rowvalues);

	  var descended = [columna];

	  var leftmost_nonblank = -1;
	  for (var j = 0; j < rowvalues.length; j++) {
		if (leftmost_nonblank == -1
			&& (! (rowvalues[j] === ""))) { leftmost_nonblank = j }
	  }
//	  Logger.log("CONF: leftmost_nonblank=%s", leftmost_nonblank);

	  for (var j = 0; j < leftmost_nonblank; j++) {
		descended[j] = previous[j];
	  }
	  for (var j = leftmost_nonblank; j < rowvalues.length; j++) {
		if (j >= 1 && ! (rowvalues[j] === "")) { previous[j] = rowvalues[j] }
		descended[j] = rowvalues[j];
	  }
//	  Logger.log("CONF: descended = %s", descended);

	  // build value -- config.a.value = b
	  config[columna].value = descended[1];

	  // build values -- config.a.values = [b,c,d]
	  config[columna].values = descended.slice(1);
//	  Logger.log("CONF: " + columna+".values=%s", config[columna].values.join(","));

	  // build tree -- config.a.tree.b.c.d.e.f=g
	  treeify_(config[columna].tree, descended.slice(1));

	  // build dict -- config.a.dict.b = [c,d,e]
	  var columns_cde = config[columna].values.slice(1);
	  if (columns_cde[0] == undefined) { continue }
	  var columnb = asvar_(descended[1]);

	  config[columna].dict[columnb] = columns_cde;
//	  Logger.log("CONF: %s", columna+".dict."+columnb+"=" + config[columna].dict[columnb].join(","));
	}
	else {
	  Logger.log("readRows: no handler for %s line %s %s ... ignoring", section, row[0], row[1]);
	}
  }

  // if we've read the entire spreadsheet, and it doesn't have an AVAILABLE TEMPLATES section, then we load the default AVAILABLE TEMPLATES from the demo master.
  if (principal != undefined &&
	  toreturn.availableTemplates.length == 0 &&
	  config.templates != undefined
	 ) {
	Logger.log("readRows: need to load default Available Templates from master spreadsheet.");
	var rrAT = readRows(getSheetbyURL(DEFAULT_AVAILABLE_TEMPLATES), entitiesByName);
 	toreturn.availableTemplates = rrAT.availableTemplates;
  }
  Logger.log("readRows: returning toreturn.availableTemplates with length %s", toreturn.availableTemplates.length);

  // an Available Templates sheet has no ENTITIES.
  if (principal == undefined) { Logger.log("readRows: principal is undefined ... we must be in an Available Templates sheet.");
								return toreturn; }

  toreturn.principal = principal;
  Logger.log("readRows(%s): setting toreturn.principal = %s", sheet.getSheetName(), principal.name);

  toreturn.principal.roles = toreturn.principal.roles || {};

  // set up the principal's .roles property.
  // also configure the vassals' _role property, though nothing uses this at the moment.
  for (var k in roles) {
	toreturn.principal.roles[k] = roles[k];
	Logger.log("readRows(%s): principal %s now has %s %s roles", sheet.getSheetName(), toreturn.principal.name, roles[k].length, k);
	for (var pi in roles[k]) {
	  var entity = entitiesByName[roles[k][pi]];
	  if (entity == undefined) { throw(k + " role " + pi + ' "' + roles[k][pi] + "\" refers to an entity that is not defined!") }
	  entity._role = entity._role || {};
	  entity._role[toreturn.principal.name] = entity._role[toreturn.principal.name] || [];
	  entity._role[toreturn.principal.name].push(k);
	  Logger.log("readRows(%s): VASSAL: entity %s knows that it is a %s to %s",
				 sheet.getSheetName(),
				 entity.name,
				 k,
				 toreturn.principal.name);
	}
  }
  var entityNames = []; for (var eN in entitiesByName) { entityNames.push(eN) }
  Logger.log("readRows(%s): have contributed to entitiesByName = %s", sheet.getSheetName(), entityNames);
  var entityNames = []; for (var eN in toreturn.entitiesByName) { entityNames.push(eN) }
  Logger.log("readRows(%s): toreturn's entitiesByName = %s", sheet.getSheetName(), entityNames);
//  Logger.log("readRows: config = %s\n", JSON.stringify(config,null,"  "));
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- getPartyCells
// TODO: make this go away -- let's just log the mailing output in one place, rather than row by row.
function getPartyCells(sheet, readrows, party) {
  Logger.log("getPartyCells: looking to return a dict of entityfieldname to cell, for party %s", party.name);
  Logger.log("getPartyCells: party %s comes from spreadsheet row %s", party.name, party._spreadsheet_row);
  Logger.log("getPartyCells: the fieldname map looks like this: %s", readrows._entityfields);
  Logger.log("getPartyCells: calling (getRange %s,%s,%s,%s)", party._spreadsheet_row, 1, 1, readrows._entityfields.length+1);
  var range = sheet.getRange(party._spreadsheet_row, 1, 1, readrows._entityfields.length+1);
  Logger.log("pulled range %s", JSON.stringify(range.getValues()));
  var toreturn = {};
  for (var f = 0; f < readrows._entityfields.length ; f++) {
	Logger.log("toreturn[%s] = range.getCell(%s,%s)", readrows._entityfields[f], 0+1,f+1);
	toreturn[readrows._entityfields[f]] = range.getCell(0+1,f+1);
  }
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- clauseroot / clausetext2num
// this is a hints db which hasn't been implemented yet. For InDesign we indicate cross-references in the XML already.
// but for the non-InDesign version we have to then number by hand.
//
var clauseroot = [];
var clausetext2num = {};
var hintclause2num = {};

// ---------------------------------------------------------------------------------------------------------------- clausehint
// xml2html musters a hint database of clause text to pathindex.
// at the start of the .ghtml file all the hints are passed to the HTMLTemplate engine by calling
// a whole bunch of clausehint_()s at the front of the file
function clausehint_(clausetext, pathindex, uniqtext) {
  hintclause2num[uniqtext || clausetext] = pathindex.join(".");
}

// ---------------------------------------------------------------------------------------------------------------- newclause
function newclause_(level, clausetext, uniqtext, tag) {
  var clause = clauseroot; // navigate to the desired clause depending on the level
  var pathindex = [clause.length];
  for (var i = 1; i < level; i++) {
    clause = clause[clause.length-1][0];
    pathindex.push(clause.length);
  }
  clause.push([[],clausetext]);

  pathindex[pathindex.length-1]++;
  clausetext2num[uniqtext || clausetext] = pathindex.join(".");
  if (clausetext == undefined) { // bullet
	var myid = pathindex.join("_");
//	return "<style>#"+myid+":before { display:block; content: \"" + pathindex.join(".") + ". \" } </style>" + "<li id=\"" + myid + "\">";
	return "<p class=\"ol_li level" + level+ "\">" + pathindex.join(".") + " ";
  } else {
      return "<h"+(level+0)+">"+pathindex.join(".") + ". " + clausetext + "</h"+(level+0)+">";
  }
}

// ---------------------------------------------------------------------------------------------------------------- clausenum
// this is going to have to make use of a hinting facility.
// the HTML template is filled in a single pass, so forward references from showclause_() to newclause_() will dangle.
// fortunately the newclauses are populated by xml2html so we can muster a hint database.
//
function clausenum_(clausetext) {
  return clausetext2num[clausetext] || hintclause2num[clausetext] || "<<CLAUSE XREF MISSING>>";
}

// ---------------------------------------------------------------------------------------------------------------- showclause
function showclause_(clausetext) {
    return clausenum + " (" + clausetext + ")";
}


// ---------------------------------------------------------------------------------------------------------------- quicktest
function quicktest() {
  Logger.log("i will run new capTable_()");
  var capTable = new capTable_();
  // Logger.log("i haz run new capTable_() and got back %s", capTable);
  capTable.columnNames();
}











// map
function roles2parties(readRows_) {
  var parties = {};
  // each role shows a list of names. populate the parties array with a list of expanded entity objects.
  for (var role in readRows_.principal.roles) {
	for (var i in readRows_.principal.roles[role]) {
	  var partyName = readRows_.principal.roles[role][i];
	  if (readRows_.entitiesByName[partyName]) {
		parties[role] = parties[role] || [];
		parties[role].push(readRows_.entitiesByName[partyName]);
		// Logger.log("populated parties[%s] = %s (type=%s)",
		// partyName, readRows_.entitiesByName[partyName].email, readRows_.entitiesByName[partyName].party_type);
	  }
	  else {
		Logger.log("WARNING: the Roles section defines a party %s which is not defined in an Entities section, so omitting from the data.parties list.", partyName);
	  }
	}
  }
  if (parties["company"] == undefined) { parties["company"] = [readRows_.principal]; }
  return parties;
}

// ---------------------------------------------------------------------------------------------------------------- createDemoUser_
function createDemoUser_(sheet, readRows_, templatedata, config) {
  if (! config.demo_mode) { return }

  Logger.log("createDemoUser_: INFO: entering Demo Mode.");

  var parties = roles2parties(readRows_);

  if (parties[asvar_(config.default_party_role.value)]) {
	Logger.log("createDemoUser_: INFO: %s is defined: %s", config.default_party_role.value, parties[asvar_(config.default_party_role.value)].name);

  } else {
	var email = Session.getActiveUser().getEmail();
	Logger.log("createDemoUser_: INFO: user is absent. creating %s, who is %s", config.default_party_role.value, email);

	Logger.log("createDemoUser_: inserting a row after " + (parseInt(readRows_._last_entity_row)+1));
	sheet.insertRowAfter(readRows_._last_entity_row+1);
	var newrow = sheet.getRange(readRows_._last_entity_row+2,1,1,sheet.getMaxColumns());

	newrow.getCell(1,1).setValue(config.default_party_role.value);
	newrow.getCell(1,2).setValue(email.replace(/@.*/,""));
	newrow.getCell(1,3).setValue(email);
	newrow.getCell(1,4).setValue("Passport Number");
	newrow.getCell(1,5).setValue("2222222");
	newrow.getCell(1,6).setValue("1729 Taxicab Way\nRamanujanville NW 01234\nNowhere");
	newrow.getCell(1,7).setValue("Nowhereland");
	newrow.getCell(1,8).setValue("person");
	newrow.getCell(1,9).setValue(config.default_party_role.value);
	SpreadsheetApp.flush();
  }

  return true;
}



// ---------------------------------------------------------------------------------------------------------------- mylogger
function mylogger(input) {
  Logger.log(input);
}



// spreadsheet functions.
// code.js needs to pass these through

function LOOKUP2D(wanted, range, left_right_top_bottom) {
  // LOOKUP2D will search for the wanted element in the range %s and return the top/bottom/left/right element corresponding from the range"
  for (var i in range) {
    for (var j in range[i]) {
      if (range[i][j] == wanted) {
        // "found it at "+i+","+j+"; returning "
        switch (left_right_top_bottom) {
          case "top":    return range[0][j];
          case "right":  return range[i][range[i].length-1];
          case "bottom": return range[range.length-1][j];
          default:       return range[i][0];
        }
      }
    }
  }
  return null;
}





// -----------------------

var _loaded = true;

