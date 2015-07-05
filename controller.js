// ---------------------------------------------------------------------------------------------------------------- otherSheets
function otherSheets() {
  var activeRange = SpreadsheetApp.getActiveRange(); // user-selected range
  var rangeValues = activeRange.getValues();
  var toreturn = [];
  for (var i = 0; i < rangeValues.length; i++) {
	var myRow = activeRange.getSheet().getRange(activeRange.getRow()+i, 1, 1, 10);
	Logger.log("you are interested in row " + myRow.getValues()[0]);
	var ss;
	try { ss = SpreadsheetApp.openById(myRow.getValues()[0][0]) } catch (e) {
	  Logger.log("couldn't open indicated spreadsheet ... probably on wrong row. %s", e);
	  throw("is your selection on the correct row?");
	  return;
	}
	var sheet = getSheetById_(ss, myRow.getValues()[0][1])
	Logger.log("smoochy says otherSheets: sheet %s is on row %s", i.toString(), myRow.getRowIndex().toString());
	myRow.getCell(1,3).setValue("=HYPERLINK(\""
								+sheet.getParent().getUrl()
								+"#gid="
								+sheet.getSheetId()
								+"\",\""
								+sheet.getParent().getName() + " / " + sheet.getName()
								+"\")");
	toreturn.push(sheet);
  }
  return toreturn;
}


// ---------------------------------------------------------------------------------------------------------------- fillOtherTemplates_
function fillOtherTemplates_() {
  var sheets = otherSheets();
  for (var i = 0; i < sheets.length; i++) {
	var sheet = sheets[i];
	Logger.log("will generate template for " + sheet.getName());
	fillTemplates(sheet);

	var uniq = uniqueKey(sheet);

	var myRow = SpreadsheetApp.getActiveSheet().getRange(SpreadsheetApp.getActiveRange().getRow()+i, 1, 1, 10);

	myRow.getCell(1,4).setValue("=HYPERLINK(\"https://drive.google.com/drive/u/0/#folders/"
								+JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.id"))
								+"\",\""
								+JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.name"))
								+"\")");

	// this loses the hyperlink
	// myRow.getCell(1,4).setValue('=IMPORTRANGE(A' +myRow.getRowIndex() +',"Founder Agreement!e6")');

	myRow.getCell(1,5).setValue("unsent");
	if (sheets.length > 1) { SpreadsheetApp.flush(); }
  }
}

function cloneSpreadsheet() {
  // only callable from the legalese controller
  // the code below was inspired by otherSheets()

  var activeRange = SpreadsheetApp.getActiveRange(); // user-selected range
  var toreturn = [];
  var legalese_root = legaleseRootFolder_();
  var mySheet = activeRange.getSheet();
  var insertions = 0;
  for (var i = 0; i < (insertions+activeRange.getValues().length); i++) {
	Logger.log("cloneSpreadsheet: i = %s; activeRange.getValues().length = %s", i, activeRange.getValues().length);

	var myRow = mySheet.getRange(activeRange.getRow()+i, 1, 1, mySheet.getLastColumn());

	// specification:
	// column A: literal txt "clone"
	// column B: source spreadsheet to clone either as a URL or a =hyperlink formula
	// column C: the new title of the spreadsheet
	// column D, E, ...: the names of the sheets that should be copied. By default, only Entities will be cloned.
	// then we reset column A and B to the the ssid and the sheetid

	Logger.log("you are interested in row " + myRow.getValues()[0]);
	if (myRow.getValues()[0][0] != "clone") { Logger.log("not a cloneable row. skipping"); continue }

	var sourceSheet;
	try { sourceSheet = hyperlink2sheet_(myRow.getFormulas()[0][1] || myRow.getValues()[0][1]) } catch (e) {
	  Logger.log("couldn't open source spreadsheet ... probably on wrong row. %s", e);
	  throw("is your selection on the correct row?");
	  return;
	}

	// duplicate the spreadsheet
	var copySS = sourceSheet.getParent().copy(myRow.getValues()[0][2]);
	Logger.log("copied %s to %s", sourceSheet.getParent().getName(), myRow.getValues()[0][2]);

	var SSfile = DriveApp.getFileById(copySS.getId());
	legalese_root.addFile(SSfile);
	DriveApp.getRootFolder().removeFile(SSfile);
	Logger.log("moved to legalese root folder");

	// columns D onward specify the names of desired sheets
	// if user did not specify any sheets then we assume that all sheets were desired
	// if user did specify then we delete all copied sheets which were not specified
	var specified = myRow.getValues()[0].splice(3).filter(function(cellvalue){return cellvalue != undefined && cellvalue.length});
	Logger.log("user specified desired sheets %s", specified);
	if (specified.length) {
	  var sheets = copySS.getSheets();
	  for (var si = 0; si < sheets.length; si++) {
		if (specified.indexOf(sheets[si].getSheetName()) == -1) { // unwanted
		  copySS.deleteSheet(sheets[si]);
		}
	  }
	}
	mySheet.getRange(myRow.getRowIndex(),4,1,myRow.getLastColumn()).clearContent();

	// which sheets are left?
	sheets = copySS.getSheets();
	Logger.log("copied spreadsheet now has %s agreement sheets: %s", sheets.length, sheets.map(function(s){return s.getSheetName()}));

	var inner_insertions = 0;

	for (var j = 0; j < sheets.length; j++) {
	  var sheet = sheets[j];
	  var newRow;

	  // first response replaces the active row. subsequent responses require row insertions.
	  if (j == 0) newRow = myRow
	  else {
		Logger.log("inserting a new row after index %s", myRow.getRowIndex());
		newRow = mySheet
		  .insertRowAfter(myRow.getRowIndex() + inner_insertions)
		  .getRange(myRow.getRowIndex()+inner_insertions+1,1,1,5);
		inner_insertions++;
	  }

	  newRow.getCell(1,1).setValue(copySS.getId());
	  newRow.getCell(1,2).setValue(sheet.getSheetId());
	  newRow.getCell(1,3).setValue("=HYPERLINK(\""
								   +copySS.getUrl()
								   +"#gid="
								   +sheet.getSheetId()
								   +"\",\""
								   +sheet.getParent().getName() + " / " + sheet.getName()
								   +"\")");
	}
	insertions += inner_insertions;
  }
}
