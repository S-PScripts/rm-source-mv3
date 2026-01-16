import { getRequestType } from "./requestTypeAnalyser.js";
export class urlFilter{
	#envConfig;
	#cacheManager;
	#errorManager;
	#apiHelper;
	#whiteListManager;
	#authInProgress = false;
	#urlFilteringApiURL;
	#deviceTokenHeader = "RM-SafetyNet-Device-Token";
	urlStates = Object.freeze({
		BLOCKED: 'BLOCKED',
		ALLOWED: 'ALLOWED',
		UNKNOWN: 'UNKNOWN',
		NOTFOUND: 'NOTFOUND',
		UNAUTHENTICATED: 'UNAUTHENTICATED',
		AUTHENTICATED: 'AUTHENTICATED'
	});
	#homePageUrl;
	#authTimer;
	constructor(envConfig, cacheManager, errorManager, apiHelper, whiteListManager){
		this.#envConfig = envConfig;
		this.#cacheManager = cacheManager;
		this.#errorManager = errorManager;
		this.#apiHelper = apiHelper;
		this.#whiteListManager = whiteListManager;
		this.#urlFilteringApiURL = envConfig.baseAPIURL + "/api/url?url=";
	}
	//Entry point for URL filtering.
	async checkURL (details, originalUrl) {
		var redirectUrl = null;
		var state = null;
		let requestUrl = originalUrl ? originalUrl : details.url;
		
		var captiveLoginUrlResponse = this.#checkIfCaptiveLoginUrl(requestUrl);
		if(captiveLoginUrlResponse.state === this.urlStates.ALLOWED){
			return {'state': this.urlStates.ALLOWED,
                    'redirectUrl': '',
					'contentFilterRequired': 0
                };
		}
		
		var whitelistReponse = await this.#checkWhitelist(requestUrl);
		if(whitelistReponse.state === this.urlStates.ALLOWED){
			return {'state': this.urlStates.ALLOWED,
                    'redirectUrl': '',
					'contentFilterRequired': 0
                };
		}
		
		let callGoApi = this.#shouldCallGoApi(details);
        if(!callGoApi)  {
           return {'state': this.urlStates.ALLOWED,
                    'redirectUrl': '',
					'contentFilterRequired': 0
                };
        }
		
		var cachedResponse =  this.#cacheManager.checkUrlCache(details.url);
		if(cachedResponse.state != this.#cacheManager.cachedStates.NOTFOUND){
			return {'state': cachedResponse.state,
                    'redirectUrl': cachedResponse.redirectUrl,
					'contentFilterRequired': cachedResponse.contentFilterEnabled,
					'method': cachedResponse.method,
					'filterListID': cachedResponse.filterListID,
					'resourceType': cachedResponse.resourceType
                };
		}
		
		//Call api/url?url=details.url	
        let apiResponse =  await this.#checkAPI(details, requestUrl);
		if (apiResponse.state === this.urlStates.UNAUTHENTICATED)
		{
			var authResponse = await this.#authenticate(requestUrl, details);
			
			//Unify authentication                    
			if(authResponse.isAuthUrl) {                   
				await this.unifyLogin(details.tabId, authResponse.redirectURL);                      
			}
			return {state : this.urlStates.UNAUTHENTICATED};
		}
		return apiResponse;
	}
	#checkIfCaptiveLoginUrl(url){
		const urlObj= new URL(url);
        let hostname = urlObj.hostname;
		let captiveLoginUrls = this.#whiteListManager.getCaptiveLoginURLs();
		if (captiveLoginUrls != null) {
			for (var i = 0; i < captiveLoginUrls.length; i++) {
				let captiveLoginUrl = new URL(captiveLoginUrls[i]);
				let captiveLoginUrlHost = captiveLoginUrl.hostname;
				if (captiveLoginUrlHost.localeCompare(hostname, "en", { sensitivity: "base" }) === 0) {
                    return {
                        response: {
                            cancel: false
                        },
                        state: this.urlStates.ALLOWED
                    }
                }
    
            }
		}
		return {state : this.urlStates.NOTFOUND};
	}
	async #checkWhitelist(url) {
		const urlObj= new URL(url);
        let hostname = urlObj.hostname;
        /* Check for white list urls in local cache.
        if match happens, bypass api/cache check for the url*/
        
		let whiteURLsInCache = await this.#whiteListManager.getWhiteListURLs();
        
		if (whiteURLsInCache != null) {
            
            for (var i = 0; i < whiteURLsInCache.length; i++) {

                if (RegExp(whiteURLsInCache[i]).test(hostname)) {
                    return {
                        response: {
                            cancel: false
                        },
                        state: this.urlStates.ALLOWED
                    }
                }
    
            }    
        }
		return {state : this.urlStates.NOTFOUND};
    }
	#shouldCallGoApi(details){
		var goFilteringEnabledTypes = this.#envConfig.BuzzFilteringEnabledTypes;
		if (goFilteringEnabledTypes.includes(details.type) && details.url.startsWith("http")) {
			 return true;
		 }

		// To fix the youtube walled garden issue, where user can see non allowed videos.
		/*
		if (details.initiator === "https://www.youtube.com" && details.type === "xmlhttprequest") {
			return true;;
		}
		*/
		return false;
	}
	//Calls the API to check whether a URL can be accessed or not for that user.
	async #checkAPI (details, requestUrl) {
		var requestType = getRequestType(details);
		let url = encodeURIComponent(requestUrl);
		let apiFullUrl = this.#urlFilteringApiURL + url + '&method=' + details.method + '&reqType=' + requestType;
		var options = {
			url: apiFullUrl,
			method: 'GET',
			retryCount: 3,
			data: null
		}
		var apiResponse = null;
		const response = await this.#apiHelper.callAPI(options);
		if (response.status == 200) {

            var decision = await response.json();
            //Check the state
            if (decision[0] == this.urlStates.BLOCKED) {
                apiResponse = {
                    'state': this.urlStates.BLOCKED,
                    'redirectUrl': decision[1],
					'contentFilterRequired': decision[3],
					'method': details.method,
					'filterListID': decision[2],
					'resourceType': requestType
                };
                await this.#cacheManager.updateUrlCache(requestUrl, this.urlStates.BLOCKED, decision[1], decision[3], decision[2], details.method, requestType);
            } else if (decision[0] == this.urlStates.ALLOWED) {
                apiResponse = {
                    'state': this.urlStates.ALLOWED,
                    'redirectUrl': decision[1],
					'contentFilterRequired': decision[3],
					'method': details.method,
					'filterListID': decision[2],
					'resourceType': requestType
                };
                await this.#cacheManager.updateUrlCache(requestUrl, this.urlStates.ALLOWED, decision[1], decision[3], decision[2], details.method, requestType);
            } else {
                apiResponse = {
                    'state': this.urlStates.UNKNOWN,
                    'redirectUrl': decision[1],
					'contentFilterRequired': decision[3]
                };
                await this.#cacheManager.updateUrlCache(requestUrl, this.urlStates.UNKNOWN, decision[1], decision[3], decision[2], details.method, requestType);
            }
        }
		else if(response.status == 401)
		{
			var decision = await response.json();
			apiResponse= {
				'state' : this.urlStates.UNAUTHENTICATED,
				'loginURL': decision.loginUrl
						}
			this.#homePageUrl = decision.homePageURL ? decision.homePageURL : this.#homePageUrl
		}
		return apiResponse;
	}

	async  #authenticate(redirectUrl, details) {
    
        await this.#setAuthTimeout(details);

        return await this.#fetchPolicyForUnify(redirectUrl);
    }

	async  #fetchPolicyForUnify(redirectUrl) {
        if(this.#cacheManager.getUserEmail()) {
            let response = await this.#getUserPolicy(this.#cacheManager.getUserEmail(), redirectUrl);
             if (response.err) {
                response =  await this.getFallbackPolicy(redirectUrl,'authenticateUser: Failed due to: ' + response.err);
             }
             return response;
        }
         
        let errMessage =  chrome.runtime.lastError ? chrome.runtime.lastError.message : ' no user email';
        return await this.getFallbackPolicy(redirectUrl,'authenticateUser: Failed to retrieve email in the extension due to: ' + errMessage);
    }

	async #getUserPolicy(email, redirectUrl) {
        let requestHeader = new Headers();
		requestHeader.set('Content-Type', 'application/json');
       
        let policyURL = this.#getDeviceTokenAPIUrl();
        let response = {};
        let options = {
            url: policyURL,
            data:  { email: email, url: redirectUrl },
            headers: requestHeader,
            method: 'POST'
         };

		 let apiResponse = await this.#apiHelper.callAPI(options);
            if (apiResponse.status == 401) {
				var data = await apiResponse.json();
                response = {
                    'status': this.urlStates.UNAUTHENTICATED,
                    'redirectURL': data.loginUrl ? data.loginUrl : undefined,
                    'isAuthUrl' :  data.loginUrl ? true : false
                };
            }
            else if (apiResponse.status === 200) {          
                response = {
                    'status': this.urlStates.AUTHENTICATED,
                    'redirectURL': redirectUrl,
                    'isAuthUrl' : false,
                };
            }
            else {
                response = {
                    err : policyURL + ' failed: http status ' + apiResponse.status + ' response: ' + apiResponse.response
                }
            }
        return response;
    }

	async #setAuthTimeout(details) {
		if (this.#authTimer) {
			clearTimeout(this.#authTimer);
		}
		this.#authTimer = setTimeout(async () => {
			this.#authTimer = null; 
			await this.#fallback(details, 'setAuthTimeout triggered');
		}, 120000);
	}

	async #fallback(details, err) {
		let apiResponse = await this.#checkAPI(details, details.url);
		if (apiResponse.state === this.urlStates.UNAUTHENTICATED) {
			await this.getFallbackPolicy(details.url, 'Fallback invoked due to: ' + err);
		}
	}

	async  getFallbackPolicy(redirectUrl, error) {
        
		let requestHeader = new Headers();
		requestHeader.set('Content-Type', 'application/json');
        let params = { url : redirectUrl, error : error };
        let fallbackURL = this.#envConfig.baseAPIURL + '/api/policy/fallback';  
        let options = {
            url: fallbackURL,
            data: params,
            headers: requestHeader,
            method: 'POST'
        };
		let response;
		let apiResponse = await this.#apiHelper.callAPI(options);
		if (apiResponse.status === 200) {
			response = {
				'status': this.urlStates.AUTHENTICATED,
				'redirectURL': redirectUrl,
			};

			const authToken = apiResponse.headers.get(this.#deviceTokenHeader);
			await  this.#cacheManager.setDeviceToken(authToken);	
		} else {
			response = {
				err: fallbackURL + ' failed: http status ' + apiResponse.status + ' response: ' + apiResponse.response
			};
		}

        return response;
    }

	#getDeviceTokenAPIUrl(){
		var deviceAuthEndPoint;
		const userAgent = navigator.userAgent;
		if (userAgent.includes("Edg")) {
			deviceAuthEndPoint = "/api/policy/azure";
		}else{
			deviceAuthEndPoint = "/api/policy/gafe";
		}
		return (this.#envConfig.baseAPIURL + deviceAuthEndPoint);
	}

	async unifyLogin(tabId, loginUrl) { 
		let activeTab = null;
		let retry = 0;
		const retryCount = 3;
		const authUrl = loginUrl;
		const homePageUrl = this.#homePageUrl; 
		this.#authInProgress = true;
	
		const createTabAndShowLogin = () => {
			chrome.tabs.create({ url: authUrl });
			this.#errorManager.logError('CreateTabAndShowLogin');
		};
	
		const showLoginInFirstTab = () => {
			this.#errorManager.logError('ShowLoginInFirstTab');
			 this.findActiveTab(false, (tab) => {
				const anyTab = tab;
				this.showLogin(anyTab ? anyTab.id : -1, authUrl, () => {
					createTabAndShowLogin();
				});
			});
		};
	
		const tryUnifyLogin = () => {
			retry++;
	
			if (activeTab) {
				return;
			}
	
			if (retry >= retryCount) {
				showLoginInFirstTab();
				return;
			}
	
			this.findActiveTab(true, (tab) => {
				activeTab = tab;
	
				if (activeTab) {
					const tabUrl = activeTab.pendingUrl ? activeTab.pendingUrl : activeTab.url;
					this.showLogin(activeTab.id, authUrl, () => {
						// Retry
						setTimeout(() => {
							tryUnifyLogin();
						}, 10);
					});
	
					return; // from findActiveTab
				}
	
				// findActiveTab failed, so retry
				setTimeout(() => {
					tryUnifyLogin();
				}, 100);
			});
		};
	
		// Try login. 
		// Retry may be required due to async nature of Chrome.
		tryUnifyLogin();
	
		if (this.loginTimer) {
			clearTimeout(this.loginTimer);
		}
	
		this.loginTimer = setTimeout(() => {
			this.loginTimer = null;       
			this.#authInProgress = false;
		}, this.#envConfig.loginTimeout); // Assuming loginTimeout is part of envConfig
	}
	
	findActiveTab(active, callback) {
		chrome.tabs.query({ currentWindow: true, active: active }, (tabs) => {
			if (tabs) {
				for (let index = 0; index < tabs.length; index++) {
					if (tabs[index].id > -1) {
						callback(tabs[index]);
						return;
					}
				}
			}
			callback(null);
		});
	}
	
	showLogin(tabId, authUrl, callback) {
		if (tabId === -1) {
			callback();
			return; 
		}
	
		try {
			chrome.tabs.update(tabId, { url: authUrl }, (tab) => {
				if (!tab) {
					this.#errorManager.logError('showLogin() chrome.tabs.update failed');                        
					callback();                            
				}
			});
		} catch (err) {
			this.#errorManager.logError(err);
			callback();  
		}
	}
}