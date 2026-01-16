export class apiHelper{
	#envConfig;
	#cacheManager;
	#urlFilter;
	#deviceTokenHeader = "RM-SafetyNet-Device-Token";
	constructor(envConfig, cacheManager,urlFilter){
		this.#envConfig = envConfig;
		this.#cacheManager = cacheManager;
		this.#urlFilter = urlFilter;
	}
	async callAPI(options, handle401Error = true){
		if (!options.url) {
            throw new Error("url parameter shouldn't be null");
        }
        if (!options.method) {
            throw new Error("method parameter shouldn't be null");
        }
        if (typeof options.retryCount !== 'number') {
            options.retryCount = 3;
        }
		
		var fetchOptionHeaders = null;
		var injectAuthorizationHeader = true;
		if(options.headers != null && options.headers.has("Authorization")){
			injectAuthorizationHeader = false;  
		}
		
		var deviceToken = await this.#cacheManager.getDeviceToken();
		if(deviceToken != null && injectAuthorizationHeader){
			fetchOptionHeaders = new Headers({
				'Authorization': 'Bearer ' + deviceToken
			});
			if(options.headers != null){
				options.headers.forEach((value, key) => {
					fetchOptionHeaders.append(key, value);
				});
			}
		}else{
			fetchOptionHeaders = options.headers;
		}
		var fetchOptions = {"method" : options.method, "body" : options.data ? JSON.stringify(options.data) : null};
		if(fetchOptionHeaders != null){
			fetchOptions.headers = fetchOptionHeaders;
		}
		try{
			var response = await fetch(options.url, fetchOptions);
			if (!response.ok) {
				console.log("Status is "+response.status);
                return await this.#handleAPIError(response, options, handle401Error);
            }
			return response;
		}catch(error){
			console.log("Error calling url " + options.url + " , Error " + error);
			return await this.#handleAPIError(response, options, handle401Error);
		}
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
	async #handleAPIError(response, options, handle401Error = true){
		if (options.retryCount < 1) {
			console.log("Error calling url.Retries exhausted. "+options.url);
			return response;
		}else if(!response){
			options.retryCount = options.retryCount - 1;
			console.log("Retrying for url " + options.url +" Retries remaining - " + options.retryCount);
			return await this.callAPI(options);
		}else {
			options.retryCount--;
			if (response.status === 401 && handle401Error) {
				console.log("401 error occurred");
				const contentType = response.headers.get("content-type");
				const cloneResponse = response.clone();
				const data = contentType?.includes("application/json") ? await cloneResponse.json() : null;
				if (data?.loginUrl) {
					return response;
				}
				var deviceTokenUrl = this.#getDeviceTokenAPIUrl();
				var userEmail = this.#cacheManager.getUserEmail();
				const fetchOptions = {
					method: "POST",
					headers: new Headers({ "Content-Type": "application/json" }),
					body: JSON.stringify({ email: userEmail, url: options.url })
					};
				try{
					var response = await fetch(deviceTokenUrl,fetchOptions);
					if (!response.ok) {
						if(response.status === 401)
						{
							const clonedResponse = response.clone();
							const contentType = response.headers.get("content-type");
							const data = contentType?.includes("application/json") ? await clonedResponse.json() : null;
							if (data?.loginUrl) {
								return response;
							}
						}
					}
					if(options.headers != null && options.headers.has("Authorization")){
						options.headers.delete("Authorization"); 
					}
					await this.#setAuthToken(response);
				}catch(error){
					await this.#urlFilter.getFallbackPolicy(options.url,"Error Occures while authenticating")
				}
			}
			console.log("Retrying for url " + options.url);
			return await this.callAPI(options);
		}
	}
	async #setAuthToken(response){
		const authToken = response.headers.get(this.#deviceTokenHeader);
		if (authToken != null) {
			await this.#cacheManager.setDeviceToken(authToken);   
		}
	}
}