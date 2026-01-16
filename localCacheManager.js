export class cacheManager{
	//Enum of different URL filter states. Object.freeze prevents functions changing the value.
    cachedStates = Object.freeze({
        BLOCKED: 'BLOCKED',
        ALLOWED: 'ALLOWED',
        UNKNOWN: 'UNKNOWN',
        NOTFOUND: 'NOTFOUND',
        UNAUTHENTICATED: 'UNAUTHENTICATED'
    });
	#cachedUrlEntries = new Map();
	#deviceTokenKey = 'deviceToken';
	#userIP ='Not Available';
	#userEmail;
	#whitelistUrlsKey = 'whitelistURLs';
	#hashedBannedWordsKey = 'hashedBannedWords';
	#contentFilterRedirectUrlKey = 'contentFilterRedirectUrl';
	#accessLogStoreTokenKey = 'accessLogStoreToken';
	#envConfig;
	constructor(envConfig){
		this.#envConfig = envConfig;
	}
	updateUrlCache(searchTermOrUrl, state, filterpageURL, contentFilterRequired, flid, method, resourceType){
        var timeStamp = new Date().getTime();
		var urlCacheDurationInMilliSeconds = (this.#envConfig.cacheExpiryTimeInMinutes) * 60 * 1000;
		var expiryTime = Date.now() + urlCacheDurationInMilliSeconds;
        var newCacheItem = {
            'state': state,
            'filterpageURL': filterpageURL,
            'timeStamp': timeStamp,
            'contentFilterEnabled': contentFilterRequired,
            'filterListID': flid,
            'method': method, 
            'resourceType': resourceType,
			'expiryTime': expiryTime
        };
        this.#cachedUrlEntries.set(searchTermOrUrl,newCacheItem);
	}
	checkUrlCache(searchTermOrUrl){
		let redirectUrl = null;
        let state = this.cachedStates.NOTFOUND;
        let contentFilterEnabled = 1;
        const cachedItem = this.#cachedUrlEntries.get(searchTermOrUrl);
		let filterListID;
		let method;
		let resourceType;

        if (cachedItem) {
			if(Date.now() > cachedItem.expiryTime){
				this.#cachedUrlEntries.delete(searchTermOrUrl);
				return {
					redirectUrl: redirectUrl,
					state: this.cachedStates.NOTFOUND,
					contentFilterEnabled: contentFilterEnabled
				};
			}
			method = cachedItem.method;
			resourceType = cachedItem.resourceType;
            if (cachedItem.state == this.cachedStates.BLOCKED) {
                redirectUrl = cachedItem.filterpageURL;
                state = this.cachedStates.BLOCKED;
				filterListID = cachedItem.filterListID;				
                contentFilterEnabled = cachedItem.contentFilterEnabled;
            } else if (cachedItem.state == this.cachedStates.ALLOWED) {
                state = this.cachedStates.ALLOWED;
				filterListID = cachedItem.filterListID;
                contentFilterEnabled = cachedItem.contentFilterEnabled;
            } else {
                state = this.cachedStates.UNKNOWN;
                contentFilterEnabled = cachedItem.contentFilterEnabled;
            }
        }

        return {
            redirectUrl: redirectUrl,
            state: state,
			filterListID: filterListID,
			method: method,
			resourceType: resourceType,
            contentFilterEnabled: contentFilterEnabled
        };
	}
	async setDeviceToken(token){
		await chrome.storage.local.set({[this.#deviceTokenKey]: token});
	}
	async getDeviceToken(){
		const data = await chrome.storage.local.get([this.#deviceTokenKey]);
		return this.#getDataFromKey(data, this.#deviceTokenKey);
	}
	setUserIP(userIP){
		this.#userIP=userIP;
	}
	getUserIP(){
		return this.#userIP;
	}
	setUserEmail(userEmailId){
		this.#userEmail = userEmailId;
	}
	getUserEmail(){
		return this.#userEmail;
	}
	async setWhiteListUrls(urlList){
		await chrome.storage.local.set({ [this.#whitelistUrlsKey] : urlList });
	}
	async getWhiteListUrls(){
		const data = await chrome.storage.local.get([this.#whitelistUrlsKey]);
		return this.#getDataFromKey(data, this.#whitelistUrlsKey);
	}
	async setHashedBannedWords(hashedBannedWords){
		await chrome.storage.local.set({ [this.#hashedBannedWordsKey] : hashedBannedWords });
	}
	async getHashedBannedWords(){
		const data = await chrome.storage.local.get([this.#hashedBannedWordsKey]);
		return this.#getDataFromKey(data, this.#hashedBannedWordsKey);
	}
	async setContentFilterRedirectUrl(contentFilterRedirectUrl){
		await chrome.storage.local.set({ [this.#contentFilterRedirectUrlKey]: contentFilterRedirectUrl });
	}
	async getContentFilterRedirectUrl(){
		const data = await chrome.storage.local.get([this.#contentFilterRedirectUrlKey]);
		return this.#getDataFromKey(data, this.#contentFilterRedirectUrlKey);
	}
	async setAccessLogStoreToken(accessLogToken, expiresOnInUTCStringFormat){
		const expiryInUTC = new Date(expiresOnInUTCStringFormat);
		const expiresOn = expiryInUTC.getTime();
		var accessLogTokenObject = {"accessLogToken":accessLogToken,"expiresOn":expiresOn};
		await chrome.storage.local.set({ [this.#accessLogStoreTokenKey]: accessLogTokenObject });
	}
	async getAccessLogStoreToken(){
		const data = await chrome.storage.local.get([this.#accessLogStoreTokenKey]);
		var accessLogTokenObject = this.#getDataFromKey(data, this.#accessLogStoreTokenKey);
		if(accessLogTokenObject == null){
			return null;
		}
		var accessLogTokenObjectExpiryLeewayInMilliSeconds = 30000; //30 seconds
		if(Date.now() > (accessLogTokenObject.expiresOn - accessLogTokenObjectExpiryLeewayInMilliSeconds)){
			await chrome.storage.local.set({ [this.#accessLogStoreTokenKey]: null });
			return null;
		}
		return accessLogTokenObject.accessLogToken;
	}
	wipeCache() {
		this.#cachedUrlEntries.clear();
		chrome.storage.local.clear(function () {
            var error = chrome.runtime.lastError;
            if (error) {
                console.error(error);
            }
        });
	}
	#getDataFromKey(dataObject, key){
		let numOfCacheItems = Object.keys(dataObject).length;
		if(numOfCacheItems > 0){
				let value = dataObject[key];
				if(value){
					return value;
				}
		}
		return null;
	}
	async checkUserIP() {
		let userIPUrl = this.#envConfig.baseAPIURL + "/api/policy/ip";
		try{
			var response = await fetch(userIPUrl);
			if (response.ok) {
				var userIP = await response.text();
				this.setUserIP(userIP);
				return true;
			}
		}catch(error){
			console.log("Error calling url " + userIPUrl + " , Error " + error);
		}
		return false;
	}
}