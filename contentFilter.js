import { CryptoJS } from "./md5.js";
export class contentFilter{
	#envConfig;
	#cacheManager;
	#apiHelper;
	#hashedWordListContentApiURL;
	banThreshold;
	constructor(envConfig, cacheManager, apiHelper){
		this.#envConfig = envConfig;
		this.#cacheManager = cacheManager;
		this.#apiHelper = apiHelper;
		this.#hashedWordListContentApiURL = envConfig.baseAPIURL + "/api/content";
		this.banThreshold = envConfig.contentFilter.banThreshold;
	}
	async getBannedWordsList() {
		var bannedWordList = await this.#cacheManager.getHashedBannedWords();
		if(bannedWordList != null){
			return bannedWordList;
		}
		// Set up options for the API call
        var options = {
            url: this.#hashedWordListContentApiURL,
            method: 'GET',
            retryCount: 3,
            headers: null,
            data: null
        };
		// Call the API
        const response = await this.#apiHelper.callAPI(options);
		// Check the response status
        if (response.status === 200) {
			var responseJson = await response.json();
            const bannedWords = responseJson.words || [];
			const contentFilterRedirectUrl = responseJson.filterpageUrl;
			await this.#cacheManager.setHashedBannedWords(bannedWords);
			await this.#cacheManager.setContentFilterRedirectUrl(contentFilterRedirectUrl);
			return bannedWords;
		}else {
            console.log("Error fetching banned words:", response.status, response.statusText);
        }
		return null;
	}
	evaluatePageContent(websiteContent, bannedWordsHashes) {
		let websiteContentlength = 0;
		let actualContentLength = websiteContent.length;
		let score = 0;
	this.#envConfig.contentFilter.banThreshold;
		if (websiteContentlength < actualContentLength) {
			const websiteContentChunks = websiteContent.match(/[\s\S]{1,20000}/g) || [];
			let earlyPageShowTriggered = false;
			for (let i = 0; i < websiteContentChunks.length; i++) {
				const chunk = websiteContentChunks[i];
				const chunkScore = this.#getPageScore(chunk, bannedWordsHashes);
				score += chunkScore;
				if (score < this.#envConfig.contentFilter.banThreshold && !earlyPageShowTriggered) {
					earlyPageShowTriggered = true;
					return 'SHOW';
				}
				// If score already exceeds threshold, stop further processing
				if (score >= this.#envConfig.contentFilter.banThreshold) {
					return 'BLOCK';
				}
			}
			websiteContentlength = actualContentLength;
			// Final call based on total score
			let action = (score >= this.#envConfig.contentFilter.banThreshold) ? 'BLOCK' : 'SHOW';
			return action;
		}
	}
	#getPageScore(websiteContent, bannedWordsHashes) {
		const q = 190011979;
		const primeBase = 16;
		const wordLengths = Object.keys(bannedWordsHashes).map(Number);

		const primeToPowers = {};
		const hashTextParts = {};

		for (let i = 0; i < wordLengths.length; i++) {
			primeToPowers[wordLengths[i]] = Math.pow(primeBase, wordLengths[i] - 1) % q;
			hashTextParts[wordLengths[i]] = this.#hashFromTo(websiteContent, 0, wordLengths[i]);
		}
		
		let score = 0;
		const maxIndexForPotentialMatch = Math.max(0, websiteContent.length - Math.min(...wordLengths));

		for (let i = 1; i <= maxIndexForPotentialMatch; i++) {
			for (let j = 0; j < wordLengths.length; j++) {
				const currentWordLength = wordLengths[j];
				const currentHashtextpart = hashTextParts[currentWordLength];
				const currentBannedWord = bannedWordsHashes[currentWordLength]?.[currentHashtextpart];

				if (currentBannedWord) {
					if (this.#matchesAtIndex(i - 1, websiteContent, currentBannedWord)) {
						score += currentBannedWord.score;
						// If score already exceeds threshold, stop further processing
						if (score >= this.#envConfig.contentFilter.banThreshold) {
							return score;
						}
					}
				}

				hashTextParts[currentWordLength] = this.#mod(
					(primeBase * (currentHashtextpart - (websiteContent.charCodeAt(i - 1) * primeToPowers[currentWordLength])) +
						(websiteContent.charCodeAt(i + currentWordLength - 1)))
				);
			}
		}
		return score;
	}	
	#matchesAtIndex(index, text, bannedWordObject) {
		var matches = false;
		var extractFromText = '';
		for (var i = index; i < index + bannedWordObject.originalLength; i++) {
			extractFromText += text[i];
		}
		if (CryptoJS.MD5(extractFromText).toString(CryptoJS.enc.Base64) == bannedWordObject.md5Hash) {
			matches = true;
		}
		return matches;
	}
	#hashFromTo(str, start, end) {
		const q = 190011979;
		const primeBase = 16;
		let hash = 0;
		let j = end - 1;

		for (let i = start; i < end && i < str.length; i++) {
			const magnitude = Math.pow(primeBase, j - i, q);
			hash = this.#mod(hash + str.charCodeAt(i) * magnitude);
		}

		return hash;
	}

	#mod(n) {
		const q = 190011979;
		return ((n % q) + q) % q;
	}
}