export class accessLogManager{
	#envConfig;
	#cacheManager;
	#errorManager;
	#apiHelper;
	#accessLogStoreEndpointUrl;
	#accessLogStoreTokenEndpointUrl;
	#manifestData;
	#browserPlatform;
    #browserVersion;
	#browserMajorVersion;
    #osVersion;
    #userAgentData;
    #osFamily;
	#device;
	
	constructor(envConfig, cacheManager, errorManager, apiHelper,manifestdata){
		this.#envConfig = envConfig;
		this.#cacheManager = cacheManager;
		this.#errorManager = errorManager;
		this.#apiHelper = apiHelper;
		this.#accessLogStoreEndpointUrl = envConfig.accessLogStoreEndpointUrl;
		this.#accessLogStoreTokenEndpointUrl = envConfig.baseAPIURL + '/log/token';
		this.#manifestData = manifestdata;
		const brand = navigator.userAgentData.brands.find(b => b.brand.includes("Edge") || b.brand.includes("Chrome"));
		this.#browserPlatform = brand && brand.brand ? (brand.brand.includes("Edge") ? "Edge" : "Google Chrome") : "";
		this.#browserVersion = brand && brand.version ? brand.version : "";
		this.#browserMajorVersion = this.#browserVersion ? this.#browserVersion.split('.')[0] : "";
		const osMatch = navigator.userAgent.match(/\(([^)]+)\)/);
		this.#osVersion = osMatch && osMatch[1] ? osMatch[1].split(';')[0].trim() : "";
		this.#userAgentData = navigator.userAgent || "";
		this.#osFamily = navigator.userAgentData.platform || "";
		this.#device = `${this.#osFamily || ''}:GOExtension_${this.#manifestData.version || ''}`;
	}
	async sendAccessLogEntry(url, logItem){
		var deviceToken = await this.#cacheManager.getDeviceToken();
		if(deviceToken == null){
			console.log("Failed to retrieve device token.Returning from access logging url");
			return false;
		}
		var jwtObject = this.#parseJwt(deviceToken);
		var dataCentreId = jwtObject.dataCentreId;
		var clientIp = await this.#cacheManager.getUserIP();
		if(clientIp == "Not Available"){
			await this.#cacheManager.checkUserIP();
			clientIp = await this.#cacheManager.getUserIP();
		}
		var accessLog = {
			"Url": url,
			"UserName": jwtObject.authUser,
			"FilterState": logItem.state,
			"HttpMethod": logItem.method,
			"EstablishmentId": jwtObject.estabId,
			"UserPolicyId": jwtObject.userPolicyId,
			"FilterListId": logItem.filterListID,
			"ResourceType": logItem.resourceType,
			"EpochTime": Date.now(),
			"ClientIp": clientIp,
			"UserAgent": this.#userAgentData,
            "BrowserPlatform": this.#browserPlatform,
            "BrowserVersion": this.#browserVersion,
            "BrowserMajorVersion": this.#browserMajorVersion,
            "OSFamily": this.#osFamily,
            "OSVersion": this.#osVersion,
            "Device": this.#device
		};
		var accessLogData = {"DCId":dataCentreId,"LogEntry":accessLog};
		var accessLogToken = await this.#cacheManager.getAccessLogStoreToken();
		if(accessLogToken == null){
			var accessLogTokenRetrieved = await this.loadAccessLogStoreToken();
			if(!accessLogTokenRetrieved){
				return false;
			}
			accessLogToken = await this.#cacheManager.getAccessLogStoreToken();
		}
		
		const accessLogHeaders = new Headers();
		accessLogHeaders.append("Authorization", accessLogToken);
		accessLogHeaders.append("Content-Type", "application/atom+xml;type=entry;charset=utf-8")
		
		var options = {
			url: this.#accessLogStoreEndpointUrl,
			method: 'POST',
			retryCount: 2,
			headers: accessLogHeaders,
			data: accessLogData
		}
		try{			
			const response = await this.#apiHelper.callAPI(options, false);
			if (!response.ok) {
				let apiLog = {
					status: response.status,
					statusText: response.statusText,
					api: 'accessLog'
				}
				await this.#errorManager.logError(this.#errorManager.errorMsgs.FAILEDLOGSTOREACCESSLOGAPICALL, apiLog);
				return false;
			}
			return true;
		}catch(error){
			let apiLog = {
						status: 'Error calling access log api',
						statusText: error,
						api: 'accessLog'
					}
			await this.#errorManager.logError(error, apiLog);
		}
		return false;
	}
	async loadAccessLogStoreToken(){
		var options = {
			url: this.#accessLogStoreTokenEndpointUrl,
			method: 'GET',
			retryCount: 2,
			headers: null,
			data: null
		}
		try{
			const response = await this.#apiHelper.callAPI(options);
			if (response.status == 200) {
				const responseJson = await response.json();
				if (Object.keys(responseJson).length > 0) {
					var accessLogStoreSASToken = responseJson.sasToken;
					var expiresOnInUTCStringFormat = responseJson.expiresOn;
					await this.#cacheManager.setAccessLogStoreToken(accessLogStoreSASToken, expiresOnInUTCStringFormat);
					return true;
				}
				return false;
			}else{
				let apiLog = {
					status: response.status,
					statusText: response.statusText,
					api: 'logToken'
				}
				await this.#errorManager.logError(this.#errorManager.errorMsgs.FAILEDLOGSTORETOKENAPICALL, apiLog);
				return false;
			}
		}catch(error){
			let apiLog = {
						status: 'Error calling log token api',
						statusText: error,
						api: 'logToken'
					}
			await this.#errorManager.logError(error, apiLog);
		}
		return false;
	}
	#parseJwt(token){
		var base64Url = token.split('.')[1];
		var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
			return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
		}).join(''));

		return JSON.parse(jsonPayload);
	}
}