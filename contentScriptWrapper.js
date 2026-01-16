if(document.getElementsByTagName('html')[0]){
	document.getElementsByTagName('html')[0].style.visibility = "hidden";
}
var url = document.URL;

(async () => {
    var envConfig = await chrome.runtime.sendMessage({ action: 'GETCONFIG' });
    if(url=== envConfig.baseAPIURL + '/auth/login/callback' || url.startsWith(envConfig.baseAPIURL + '/auth/login/legacycallback'))
    {
        showPage();
        let bodyContent = document.getElementsByTagName("body");
        let pageContent = bodyContent[0].innerText.trim();
        const parsedContent = JSON.parse(pageContent);
        document.getElementsByTagName('html')[0].style.visibility = "hidden";
        var response = await chrome.runtime.sendMessage({action: 'SETTOKENFORUNIFY', token:parsedContent.token,"url":parsedContent.redirectUrl });
    }
	const urlFilteringResponse = await chrome.runtime.sendMessage({"action":"URLFILTER", "url":url, "type":"main_frame", "method":"GET"});
	if (!urlFilteringResponse) {
        alert("Something went wrong");
        window.stop();
    }
    if (urlFilteringResponse.state === "BLOCKED") {
        document.getElementsByTagName('html')[0].style.visibility = "hidden";
    }
	if(urlFilteringResponse && urlFilteringResponse.state != "BLOCKED"){
		showPage();
		var contentFilterRequired = (urlFilteringResponse.state === "ALLOWED")? 0 : urlFilteringResponse.contentFilterRequired;
		if(contentFilterRequired){
			await doResponseFiltering(envConfig);
		}else if(urlFilteringResponse.state != "ALLOWED"){
			var response = await chrome.runtime.sendMessage({action: 'SENDACCESSLOGFORUNKNOWNFILTERINGSTATUS', "url":url});
		}
	}

})();

async function doResponseFiltering(envConfig) {
    var isEnabled = await chrome.runtime.sendMessage({ action: 'GETEXTENSIONSTATE' });
	if(isEnabled){
		var pageReaderInterval = setInterval(async function() {
                var pageContent = getPageContent();

                if (pageContent.length > 0) {
                    //console.log(pageContent);
                    clearInterval(pageReaderInterval);
					await initiateContentFilter(pageContent, envConfig);
                } else if (getReadyState() === 'complete') {
                    clearInterval(pageReaderInterval);
                    showPage();
					var response = await chrome.runtime.sendMessage({action: 'SENDACCESSLOGFORUNKNOWNFILTERINGSTATUS', "url":url});
					observeFurtherPageChanges(envConfig);
                }
            }, 1000);
	}
}

async function initiateContentFilter(pageContent, envConfig) {
	var response = await chrome.runtime.sendMessage({action: 'CONTENTFILTER', "url":url, pageContent: pageContent});
	if (response == 'SHOW') {
        showPage();
    } 
    if (envConfig.contentFilter.enablePageObservations) {
        observeFurtherPageChanges(envConfig);
    }
}

function observeFurtherPageChanges(envConfig) {
    var observer = new MutationObserver(function() {
        observer.disconnect();
        checkPageContent();
    });

    observer.observe(document.getElementsByTagName("body")[0], {
        attributes: false,
        childList: true,
        characterData: false,
        subtree: true,
    });

    var checkPageContent = debounce(async function() {
        var pageContent = getUpdatedPageContent();
       
        if (pageContent.length > 0) {
            //console.log(pageContent);
            await initiateContentFilter(pageContent, envConfig);
        }
    }, envConfig.contentFilter.pageOvservationsDebounce);
}

function debounce(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

function getPageContent() {
    let bodyContent = document.getElementsByTagName("body");
    let pageContent = "";

    if (bodyContent && bodyContent.length > 0) {
        pageContent = bodyContent[0].innerText.trim().replace(/\s/g, " ").toLowerCase();
    }

    var currentUrl = document.URL.toLowerCase();
    if (currentUrl.includes("oneiris") || currentUrl.includes("salesforce")) {
        document.getElementsByTagName('html')[0].style.visibility = "visible";
    } else {
        document.getElementsByTagName('html')[0].style.visibility = "hidden";
    }

    return pageContent;
}

function showPage() {
    document.getElementsByTagName('html')[0].style.visibility = "visible";
}

function getReadyState() {
    return document.readyState;
}

function getUpdatedPageContent() {
    return document.getElementsByTagName("body")[0].innerText.trim().replace(/\s/g, " ").toLowerCase();
}


