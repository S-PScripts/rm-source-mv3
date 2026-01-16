export class whitelistManager{
	#envConfig;
	#cacheManager;
	#errorManager;
	#apiHelper;
	#whitelistApiURL;
	#captiveLoginUrls;
	constructor(envConfig, cacheManager, errorManager, apiHelper){
		this.#envConfig = envConfig;
		this.#cacheManager = cacheManager;
		this.#errorManager = errorManager;
		this.#apiHelper = apiHelper;
		this.#whitelistApiURL = envConfig.baseAPIURL + "/whitelist";
		this.#captiveLoginUrls = [];
	}
	async getWhiteListURLs(){
		var whiteListUrls = await this.#cacheManager.getWhiteListUrls();
		if(whiteListUrls == null){
			return (await this.loadWhiteListURLs());
		}
		return whiteListUrls;
	}
	setCaptiveLoginURLs(captiveLoginUrls){
		this.#captiveLoginUrls = captiveLoginUrls;
	}
	getCaptiveLoginURLs(){
		return this.#captiveLoginUrls;
	}
	async loadWhiteListURLs(){
		var options = {
			url: this.#whitelistApiURL,
			method: 'GET',
			retryCount: 2,
			headers: null,
			data: null
		}
		try{
			const response = await this.#apiHelper.callAPI(options);
			if (response.status == 200) {
				const responseJson = await response.json();
				if (responseJson.length > 0) {
					await this.#cacheManager.setWhiteListUrls(responseJson);
				}
				return responseJson;
			}else{
				let apiLog = {
					status: response.status,
					statusText: response.statusText,
					api: 'whitelist'
				}
				await this.#errorManager.logError(this.#errorManager.errorMsgs.FAILEDWHITELISTCALL, apiLog);
				return null;
			}
		}catch(error){
			let apiLog = {
						status: 'Error calling whitelist api',
						statusText: error,
						api: 'whitelist'
					}
			await this.#errorManager.logError(error, apiLog);
		}
		return null;
	}
}
