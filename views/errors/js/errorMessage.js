var params1 = document.body.getElementsByTagName('script');
var errorMsg = "";
let errorTxt = "";
if (params1) {
    var params = (window.location.hash.substr(1)).split("&");
    for (i = 0; i < params.length; i++) {

        var a = params[i].split("=");
        if (a[0] == "msg") {
            errorMsg = decodeURIComponent(a[1]);
        }
        if (a[3] == "#txt") {
            errorTxt = decodeURIComponent(a[4]);
        }
    }
    if(errorMsg.length>0)
        console.log(errorMsg)
    console.log(errorTxt)
    document.getElementById("errorMsgSpn").innerHTML = atob(errorMsg) + ' ' + atob(errorTxt);
}