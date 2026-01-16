export class errorManager{
	#envConfig;
	#apiHelper;
	#logErrorApiUrl;
	errorMsgs = Object.freeze({
		AUTH_FAILURE: 'E100',
		INVALIDWORDLISTSTATUS: 'E101',
		FAILEDAPICHECK: 'E102',
		INVALIDAPISTATUS: 'E103',
		INVALIDWHITELISTSTATUS: 'E104',
		INVALIDWORDLIST: 'E105',
		FAILEDWORDLISTCALL: 'E106',
		FAILEDWHITELISTCALL: 'E107',
		FAILEDLOGSTORETOKENAPICALL: 'E108',
		FAILEDLOGSTOREACCESSLOGAPICALL: 'E109'
	});
	errorMsgsText = Object.freeze({
		AUTH_FAILURE: 'Unable to get unify Authentication Token',
		INVALIDWORDLISTSTATUS: 'Unable to connect to SafetyNet Server',
		FAILEDAPICHECK: 'Unable to connect to SafetyNet Server',
		INVALIDAPISTATUS: 'Unable to connect to SafetyNet Server',
		INVALIDWHITELISTSTATUS: 'Unable to connect to SafetyNet Server',
		INVALIDWORDLIST: 'Unable to connect to SafetyNet Server',
		FAILEDWORDLISTCALL: 'Unable to connect to SafetyNet Server',
		FAILEDWHITELISTCALL: 'Unable to connect to SafetyNet Server',
		FAILEDLOGSTORETOKENAPICALL: 'Unable to connect to SafetyNet Server',
		FAILEDLOGSTOREACCESSLOGAPICALL: 'Unable to connect to SafetyNet Server'
	});
	constructor(envConfig, apiHelper){
		this.#envConfig = envConfig;
		this.#apiHelper = apiHelper;
		this.#logErrorApiUrl = envConfig.baseAPIURL + '/log/error';
	}
	async logError(err, apiLog){
        var browserPlatform;
		const userAgent = navigator.userAgent;
        if (userAgent.includes("Edg")) {
            browserPlatform = "Edge"
        } 
        else if(userAgent.includes("Chrome"))
        {
            browserPlatform = "Chrome"
        }
		try {
			let errorMsg = err.stack ? err.stack : err;
			let apiDetails = '';
			if (apiLog) {
				let httpStatus = apiLog.status + ' ' + apiLog.statusText;
				let api = apiLog.api;
				apiDetails = ', API Called: ' + api + ', HTTP Status: ' + httpStatus;
			}

			let version = chrome.runtime.getManifest().version;
			errorMsg = browserPlatform + ' Version : ' + version + ', message: ' + errorMsg + apiDetails;
			var headers = new Headers({"Content-Type":"application/json"});
			let params = {"error" : errorMsg};
			let options = {
				url: this.#logErrorApiUrl,
				retryCount: 0,
				data: params,
				headers: headers,
				method: 'POST'
			};

			const response = await this.#apiHelper.callAPI(options); 

		} catch (err) {
			console.log("Error in logError : " + err);
		}
    }
	showInitPage(tabId ){
		chrome.tabs.update(tabId, { url: chrome.extension.getURL(this.#envConfig.initPageLocation) });
	}
	async showErrorPage(tabId, errorCode, errorTxt, apiLog, errorMsg) {
		try {
			await this.logError(errorCode + (errorMsg ? (', details: ' + errorMsg) : '' ), apiLog);

			if (errorCode != this.errorMsgs.FAILEDAPICHECK) {
				if (navigator.onLine) {
					let errCode = errorCode;
					let errTxt = errorTxt;
					if(!Object.values(this.errorMsgs).includes(errorCode)) {
						errCode = 'UNDEFINED';
					}
					if(!Object.values(this.errorMsgsText).includes(errTxt)) {
						errTxt = 'UNDEFINED';
					}
					var errorPageUrl = await  this.formatErrorPageUrl(errCode, errTxt);

					// Show error page in the tab where the request was made from
					if (tabId != -1) {
						chrome.tabs.update(tabId, { url: errorPageUrl });
					}
					// If tab ID is null then open a new tab with the error page
					else {
						chrome.tabs.getSelected(null, function (tab) {
							var parser = document.createElement('a');
							parser.href = tab.url;
							//// used for showing chrome extension page and history pages 
							if (parser.protocol != 'chrome:') {
								chrome.tabs.update(tab.id, { url: errorPageUrl });
							}
						});

					}
				}
			}
		}
		catch {
			console.log(errorCode + (errorMsg ? (', details: ' + errorMsg) : '' ));
		}
	}
	showFilterPage(tabId, filterPageUrl, estID) {
		if (filterPageUrl == '') {
			chrome.tabs.getSelected(null, function (tab) {
				chrome.tabs.update(tab.id, { url: chrome.extension.getURL(this.#envConfig.filterPageLocation) });
			});
		}
		else {
			formatFilterPageUrl(filterPageUrl, estID, function (callback) {
				if (navigator.onLine) {
					chrome.tabs.getSelected(null, function (tab) {
						chrome.tabs.update(tab.id, { url: callback });
					});
				}
			});
		}
	}
	formatFilterPageUrl(filterPageUrl, estID, cb) {
		var n = filterPageUrl.indexOf(".htm#");
		var queryString = filterPageUrl.substr(n + 4, filterPageUrl.length);
		filterPageUrl = chrome.extension.getURL(this.#envConfig.filterPageLocation) + queryString + '&est=' + estID
		cb(filterPageUrl);
	}
	
	async formatErrorPageUrl(msg, txt) {
		return chrome.runtime.getURL(this.#envConfig.errorPageLocation) + '#msg=' + btoa(msg) + '#txt=' + btoa(txt);
	}
	
}
