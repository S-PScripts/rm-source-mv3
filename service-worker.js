import { cacheManager } from "./localCacheManager.js";
import { apiHelper } from "./apiHelper.js";
import { errorManager } from "./errorManager.js";
import { whitelistManager } from "./whitelistManager.js";
import { urlFilter } from "./urlFilter.js";
import { contentFilter } from "./contentFilter.js";
import { accessLogManager } from "./accessLogManager.js";

var envConfig ;
var _cacheManager;
var _apiHelper;
var _errorManager;
var _whitelistManager;
var _urlFilter;
var _contentFilter;
var _accessLogManager;
var isEnabled = false;
var manifestdata;

getUserEmailAndBootStrapExtension();

function getUserEmailAndBootStrapExtension() {
	chrome.identity.getProfileUserInfo(async(profileUserInfo) => {
		await runExtension(profileUserInfo.email);
	});
	return;
}

async function runExtension(userEmailId) {
	isEnabled = true;

	var response = await fetch('config/envconfig.json');
	envConfig = await response.json();
	var data = await fetch('manifest.json');
	manifestdata = await data.json();
	
	_cacheManager = new cacheManager(envConfig);
	_cacheManager.setUserEmail(userEmailId);
	console.log("Email is "+ userEmailId);
	
	_apiHelper = new apiHelper(envConfig, _cacheManager);
	_errorManager = new errorManager(envConfig, _apiHelper);
	
	_whitelistManager = new whitelistManager(envConfig, _cacheManager, _errorManager, _apiHelper);
	
	var whiteListUpdateIntervalInMinutes = (envConfig.whitelistUpdateInterval/1000)/60;
	await chrome.alarms.create('whitelist-update-alarm', {
		delayInMinutes: 5,
		periodInMinutes: whiteListUpdateIntervalInMinutes
	});
	
	chrome.alarms.onAlarm.addListener(async (alarm) => {
		if(alarm.name == 'whitelist-update-alarm'){
			await _whitelistManager.loadWhiteListURLs();
		}
	});
	
	// Get the connection type.
	const type = navigator.connection.type;
	async function changeHandler(e) {
		if(navigator.onLine)
		{
			var captivePortalUrls = await checkForCaptivePortalPresence();
			if(captivePortalUrls !== null && captivePortalUrls.length > 0){
				_whitelistManager.setCaptiveLoginURLs(captivePortalUrls);
			}
			await  _cacheManager.checkUserIP();
		}
	}
  	navigator.connection.onchange = changeHandler;
	
	_urlFilter = new urlFilter(envConfig, _cacheManager, _errorManager, _apiHelper, _whitelistManager);
	
	_contentFilter = new contentFilter(envConfig, _cacheManager, _apiHelper);
	
	_accessLogManager = new accessLogManager(envConfig, _cacheManager, _errorManager, _apiHelper,manifestdata);
	
	var captivePortalUrls = await checkForCaptivePortalPresence();
	

	if(captivePortalUrls === null || captivePortalUrls.length < 1){
		await _whitelistManager.loadWhiteListURLs();
		var deviceToken = await _cacheManager.getDeviceToken();
		if(deviceToken == null){
			var success = await retrievePolicyToken(envConfig, _cacheManager, _apiHelper, userEmailId);
			if(success){
				await _contentFilter.getBannedWordsList();
				var accessLogToken = await _cacheManager.getAccessLogStoreToken();
				if(accessLogToken == null){
					await _accessLogManager.loadAccessLogStoreToken();
				}
			}else{
				console.log("Retrieve policy token failed for Email "+ userEmailId);
			}
		}
		await  _cacheManager.checkUserIP();
	}else{
		_whitelistManager.setCaptiveLoginURLs(captivePortalUrls);
	}
	
	
	chrome.webRequest.onBeforeRequest.addListener(function (details) {
        // safe search
        if (details.type == 'xmlhttprequest' || details.type === 'main_frame') {
            var safeResponse = forceSafeSearch(details);
            if (safeResponse) {
                return safeResponse;
            }
			var cachedResponse =  _cacheManager.checkUrlCache(details.url);
			if (cachedResponse.state === "BLOCKED") {
				// call access log here without waiting
				chrome.tabs.update(details.tabId, { url: cachedResponse.redirectUrl });
				var accessLogItem = {
					"state": cachedResponse.state,
					"method": cachedResponse.method,
					"filterListID": cachedResponse.filterListID,
					"resourceType": cachedResponse.resourceType
					};
				_accessLogManager.sendAccessLogEntry(details.url, accessLogItem);
				return { cancel: true };
			}
        }
    }, {urls: ['http://*/*', 'https://*/*']}, ['blocking']);

	/*
	This will ensure compatibility for users between the V2 and V3 extensions who use 
	Unify as their authentication method. It will provide a smooth transition for users from 
	V2 to V3 for a short period, allowing customers to continue using V2 before fully migrating to V3.
	Once all users have transitioned to V3, this code can be removed
	*/

	chrome.webRequest.onHeadersReceived.addListener(
         function(details) {
            if(details.statusCode == 302)
			{
				var tokenValue = null;
				var redirectUrlUnify=null;
			 	for (var i = 0; i < details.responseHeaders.length; i++) {
                	if (details.responseHeaders[i].name == 'RM-SafetyNet-Device-Token') {
                		tokenValue = details.responseHeaders[i].value;
                	}
					if (details.responseHeaders[i].name == 'Location') {
                		redirectUrlUnify = details.responseHeaders[i].value;
                	}
           		}
				if(tokenValue){
					var legacycallbackUrl = envConfig.baseAPIURL + "/auth/login/legacycallback";
					var encodedToken = encodeURIComponent(tokenValue);
					var finalUrl = `${legacycallbackUrl}?token=${encodedToken}&redirectUrl=${redirectUrlUnify}`;
					chrome.tabs.update(details.tabId, { url: finalUrl });
				}
			}
        }, {
            urls: [envConfig.oldBaseAPIURL + '/auth/login/callback']
        }, ['blocking', 'responseHeaders']
	);
	
	// Clears the autentication token and locally stored data on logout
    chrome.webRequest.onBeforeRequest.addListener(function(details) {
        _cacheManager.wipeCache();
	}, {urls:'' ,urls: [envConfig.baseAPIURL + '/auth/logout*']});
	
	chrome.runtime.onMessage.addListener(function(message, sender, sendResponse){
		if (message.action === "URLFILTER") {
			(async () => {
				try{
					var details = {"url":message.url,"type":message.type, "method": message.method};
					var urlFilteringResponse;
					try{
						urlFilteringResponse = await _urlFilter.checkURL (details, message.url);
					}catch(e){
						// Checking the presence of captive portal and retrying url filtering
						// This is required due to the unreliable nature of network change event which may not work always
						var captivePortalUrls = await checkForCaptivePortalPresence();
						if(captivePortalUrls !== null && captivePortalUrls.length > 0){
							_whitelistManager.setCaptiveLoginURLs(captivePortalUrls);
							urlFilteringResponse = await _urlFilter.checkURL (details, message.url);
						}else{
							throw e;
						}
					}
					const tabToCheck = await chrome.tabs.get(sender.tab.id);
					const tabUrl = tabToCheck.url;
					if(urlFilteringResponse.state === "BLOCKED"){
						if(message.url.toLowerCase() == tabUrl.toLowerCase()){
							chrome.tabs.update(sender.tab.id, { url: urlFilteringResponse.redirectUrl })
						}
					}
					if(urlFilteringResponse.filterListID){
						var accessLogItem = {
							"state": urlFilteringResponse.state,
							"method": urlFilteringResponse.method,
							"filterListID": urlFilteringResponse.filterListID,
							"resourceType": urlFilteringResponse.resourceType
							};
						_accessLogManager.sendAccessLogEntry(message.url, accessLogItem);
					}
					sendResponse(urlFilteringResponse);
				}catch(error){
					console.log(error);
					let apiLog = {};
					await _errorManager.logError(error,apiLog);
					await _errorManager.showErrorPage(sender.tab.id, _errorManager.errorMsgs.INVALIDAPISTATUS,  _errorManager.errorMsgsText.INVALIDAPISTATUS, apiLog,  _errorManager.errorMsgsText.INVALIDAPISTATUS);	
					sendResponse({ error: "Failed to check URL" });					
				}
			})();	
		}else if (message.action == 'GETCONFIG') {
            sendResponse(envConfig);
        }else if (message.action == 'GETEXTENSIONSTATE') {
            sendResponse(isEnabled);
        }else if (message.action == "CONTENTFILTER") {
			(async () => {
				var bannedWordsHashes = await _contentFilter.getBannedWordsList();

				// Fixed the issue where page shows blank when there is a delay/error in getting banned words
				if (!bannedWordsHashes) {
					sendResponse('SHOW');
				}
				else{
					var response = _contentFilter.evaluatePageContent(message.pageContent, bannedWordsHashes);
					var filterListId = (response == 'BLOCK') ? 0 : -1;
					var filterStatus = (response == 'BLOCK') ? _urlFilter.urlStates.BLOCKED : _urlFilter.urlStates.UNKNOWN;
					if(response == 'BLOCK'){
						var filterPageUrl = await _cacheManager.getContentFilterRedirectUrl();
						chrome.tabs.update(sender.tab.id, {url: filterPageUrl});
					}
					var accessLogItem = {
							"state": filterStatus,
							"method": "GET",
							"filterListID": filterListId,
							"resourceType": "html"
							};
						_accessLogManager.sendAccessLogEntry(message.url, accessLogItem);
					sendResponse(response);
				}
			})();
		}else if (message.action == "SENDACCESSLOGFORUNKNOWNFILTERINGSTATUS") {
			var accessLogItem = {
							"state": _urlFilter.urlStates.UNKNOWN,
							"method": "GET",
							"filterListID": -1,
							"resourceType": "html"
							};
			_accessLogManager.sendAccessLogEntry(message.url, accessLogItem);
			sendResponse('ACCESSLOGGED');
		}
		else if(message.action == "SETTOKENFORUNIFY")
		{
			(async () => {
				if(message.token != null)
				{
				await  _cacheManager.setDeviceToken(message.token);
				chrome.tabs.update(sender.tab.id, { url: message.url });
				}
				else{
					await _urlFilter.getFallbackPolicy(message.url,"Unify Authentication Failed due to null token");
					chrome.tabs.update(sender.tab.id, { url: message.url });
				}
				sendResponse(response);	
			})();
			return true; 
		}
		// Keeps the channel open https://developer.chrome.com/extensions/runtime#event-onMessage
        return true;
	});
	
	/*
        When the extension is updated the cache should be cleared. This is to help with
        compatibility issues between versions.
    */
    chrome.runtime.onInstalled.addListener(function(reason) {
        if (reason.reason === "update") {
            _cacheManager.wipeCache();
        }
    })
}

async function checkForCaptivePortalPresence() {
	let testUrl = envConfig.baseAPIURL + "/api/policy/connectiontest";
	let connectionTestUrl = testUrl.replace("https","http");
	try{
		let captivePortalUrlsFound = [];
		var response = await fetch(connectionTestUrl);
		if (response.redirected) {
			let redirectUrl = response.url;
			captivePortalUrlsFound.push(redirectUrl);
		}
		return captivePortalUrlsFound;
	}catch(error){
		console.log("Error calling url " + connectionTestUrl + " , Error " + error);
		return null;
	}
}
async function retrievePolicyToken(envConfig, _cacheManager, _apiHelper, userEmail) {
	const userAgent = navigator.userAgent;
	var policySubUrl;
	if (userAgent.includes("Edg")) {
		policySubUrl = "/api/policy/azure";
	}else{
		policySubUrl = "/api/policy/gafe";
	}
	
	var policyApiUrl = envConfig.baseAPIURL + policySubUrl;
	
	var headers = new Headers({"Content-Type":"application/json"});
	
	var bodyData = {"email": userEmail, "url":""};
	var options = {
			url: policyApiUrl,
			method: 'POST',
			retryCount: 3,
			headers: headers,
			data: bodyData
		};
	var response = await _apiHelper.callAPI(options);
	if(response)
	{
		if (response.status == 200) {
			const authToken = response.headers.get("RM-SafetyNet-Device-Token");
			if (authToken != null) {
				await _cacheManager.setDeviceToken(authToken);
				return true;
			}
		}
	}
	return false;
}

// forcing safe search
function forceSafeSearch(details) {
            
    const parser = new URL(details.url);
    var hostname = parser.hostname;

    // Google
    if (hostname.toLowerCase().indexOf('www.google') > -1) {
        if ((parser.pathname.indexOf("search") != -1 && details.url.indexOf("q=") != -1)) {
            if (details.url.indexOf("safe=active") == -1) {
                return formatGoogleSearches(details.url, '&safe=active'); 
            } else {
                // safe=active alreday there    and check for duplicates like safe=off
                return checkDuplicateSafeSearch('safe', 'active', details.url, parser);
            }
        }
    }
    // Bing
    else if (hostname.toLowerCase().indexOf('bing.com') > -1) {
        if (parser.pathname.indexOf("search") != -1 && details.url.indexOf("q=") != -1) {
            if (details.url.indexOf("&adlt=strict") == -1) {
                return {redirectUrl: details.url + '&adlt=strict'};
            } else {
                return checkDuplicateSafeSearch('adlt', 'strict', details.url, parser);
            }
        }
    }

    // Yahoo
    else if (hostname.toLowerCase().indexOf("yahoo.com") > -1) {

        if (parser.pathname.indexOf("search") != -1 && details.url.indexOf("p=") != -1) {
            if (details.url.indexOf("&vm=r") == -1) {
                return {redirectUrl: details.url + '&vm=r'};
            } else {
                return checkDuplicateSafeSearch('vm', 'r', details.url, parser);
            }
        }
    }

    return null;
}

// check for duplicate safe query string 
// we can manually give safe query string, safe=off for example.
function checkDuplicateSafeSearch(safeKey, safeValue, url, parser) {
    var count = (parser.search.match(new RegExp(safeKey + '=', 'g')) || []).length;
    if (count > 1) {
        var redirect = false;
        var redirectUrl = url;
        var vars = parser.search.split("&");
        for (var i = 0; i < vars.length; i++) {
            var pair = vars[i].split("=");
            if (pair[0] == safeKey && pair[1] != safeValue) {
                redirectUrl = redirectUrl.replace('&' + vars[i], '');
                redirect = true;
            }
        }
        if (redirect) {
            return{redirectUrl: redirectUrl};
        }
    }

    return null;
}

/* this is to avoid the redirect of google search results to google home page on resubmiting 
the url or on opening search url in seperate tab. Adding the safeykey after the anchor(#) in google search url was causing issue. 
So if url contains an anchor to some element, just add the safekey before the anchor*/
function formatGoogleSearches(url, safeKey){
    var n=url.indexOf('#');
    if(n != -1){
        url = [url.slice(0, n), safeKey, url.slice(n)].join('');
    }else{
        url = url + safeKey;
    }
    return {redirectUrl: url};
}